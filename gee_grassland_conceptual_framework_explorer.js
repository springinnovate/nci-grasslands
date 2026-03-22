var DEFAULTYEAR = "2005";
var ERA5_DATASET = "ECMWF/ERA5/MONTHLY";
var ERA5_SCALE_METERS = 30000;
var ERA5_START_YEAR = 1979;
var ANNUAL_TEMPERATURE_STAT = "mean";
var GROWING_SEASON_TEMP_C = 5;
var INTERANNUAL_RAINFALL_WINDOW_YEARS = 10;
var CLEAR_LABEL = "(*clear*)";

function toCelsius(image) {
    return image.subtract(273.15);
}

function toMillimeters(image) {
    return image.multiply(1000);
}

function yearStart(year) {
    return ee.Date.fromYMD(ee.Number(year).toInt(), 1, 1);
}

function era5MonthlyForYear(year) {
    var start = yearStart(year);
    return ee
        .ImageCollection(ERA5_DATASET)
        .filterDate(start, start.advance(1, "year"));
}

function growingSeasonMonthlyForYear(year) {
    return era5MonthlyForYear(year).map(function (image) {
        var isGrowingSeason = image
            .select("mean_2m_air_temperature")
            .gte(ee.Number(GROWING_SEASON_TEMP_C).add(273.15));
        return image.updateMask(isGrowingSeason);
    });
}

function annualPrecipForYear(year) {
    return toMillimeters(
        era5MonthlyForYear(year).select("total_precipitation").sum()
    ).rename("annual_precip_mm");
}

function annualTemperatureForYear(year) {
    var monthly = era5MonthlyForYear(year).select("mean_2m_air_temperature");
    var image =
        ANNUAL_TEMPERATURE_STAT === "median"
            ? monthly.median()
            : monthly.mean();
    return toCelsius(image);
}

function annualMinTemperatureForYear(year) {
    return toCelsius(
        era5MonthlyForYear(year).select("minimum_2m_air_temperature").min()
    );
}

function annualMaxTemperatureForYear(year) {
    return toCelsius(
        era5MonthlyForYear(year).select("maximum_2m_air_temperature").max()
    );
}

function growingSeasonAverageTemperatureForYear(year) {
    return toCelsius(
        growingSeasonMonthlyForYear(year)
            .select("mean_2m_air_temperature")
            .mean()
    );
}

function growingSeasonAveragePrecipitationForYear(year) {
    return toMillimeters(
        growingSeasonMonthlyForYear(year).select("total_precipitation").mean()
    );
}

function interannualRainfallVariability(endYear) {
    var startYear = ee
        .Number(endYear)
        .subtract(INTERANNUAL_RAINFALL_WINDOW_YEARS - 1)
        .max(ERA5_START_YEAR)
        .toInt();
    var years = ee.List.sequence(startYear, endYear);
    var annualTotals = ee.ImageCollection.fromImages(
        years.map(function (year) {
            return annualPrecipForYear(year);
        })
    );
    var mean = annualTotals.mean().rename("B0");
    var stdDev = annualTotals.reduce(ee.Reducer.stdDev()).rename("B0");
    return stdDev.divide(mean).multiply(100).updateMask(mean.neq(0));
}

function makeLayerDefinition(name, build, defaultRange) {
    return {
        name: name,
        build: function (year) {
            return ee.Image(build(year)).rename("B0");
        },
        defaultRange: defaultRange
    };
}

var LAYER_DEFINITIONS = [
    makeLayerDefinition(
        (ANNUAL_TEMPERATURE_STAT === "median" ? "Median" : "Mean") +
            " annual temperature (°C)",
        annualTemperatureForYear,
        { min: -20, max: 30 }
    ),
    makeLayerDefinition(
        "Minimum annual temperature (°C)",
        annualMinTemperatureForYear,
        { min: -40, max: 20 }
    ),
    makeLayerDefinition(
        "Maximum annual temperature (°C)",
        annualMaxTemperatureForYear,
        { min: 0, max: 45 }
    ),
    makeLayerDefinition("Annual precipitation (mm)", annualPrecipForYear, {
        min: 0,
        max: 3000
    }),
    makeLayerDefinition(
        "Growing season avg temp (°C)",
        growingSeasonAverageTemperatureForYear,
        { min: 0, max: 25 }
    ),
    makeLayerDefinition(
        "Growing season avg precipitation (mm)",
        growingSeasonAveragePrecipitationForYear,
        { min: 0, max: 250 }
    ),
    makeLayerDefinition(
        "Interannual rainfall variability (CV %, " +
            INTERANNUAL_RAINFALL_WINDOW_YEARS +
            "-year)",
        interannualRainfallVariability,
        { min: 0, max: 50 }
    )
];

var legend_styles = {
    black_to_red: ["000000", "005aff", "43c8c8", "fff700", "ff0000"],
    blue_to_green: ["440154", "414287", "218e8d", "5ac864", "fde725"],
    cividis: ["00204d", "414d6b", "7c7b78", "b9ac70", "ffea46"],
    viridis: ["440154", "355e8d", "20928c", "70cf57", "fde725"],
    blues: ["f7fbff", "c6dbef", "6baed6", "2171b5", "08306b"],
    reds: ["fff5f0", "fcbba1", "fb6a4a", "cb181d", "67000d"],
    turbo: ["321543", "2eb4f2", "affa37", "f66c19", "7a0403"]
};
var default_legend_style = "blue_to_green";

function changeColorScheme(key, active_context) {
    active_context.visParams.palette = legend_styles[key];
    active_context.build_legend_panel();
    active_context.updateVisParams();
}

function detectRange(image, geometry, fallbackRange, callback) {
    var dictionary = image.reduceRegion({
        reducer: ee.Reducer.percentile([10, 90], ["p10", "p90"]),
        geometry: geometry,
        scale: ERA5_SCALE_METERS,
        bestEffort: true,
        maxPixels: 1e8,
        tileScale: 4
    });

    ee.data.computeValue(dictionary, function (val) {
        var min = val && val.B0_p10;
        var max = val && val.B0_p90;

        if (
            min === null ||
            min === undefined ||
            max === null ||
            max === undefined
        ) {
            callback(fallbackRange);
            return;
        }

        if (min === max) {
            callback(fallbackRange);
            return;
        }

        callback({ min: min, max: max });
    });
}

function makeLegendPanel(active_context) {
    function makeRow(color, name) {
        var colorBox = ui.Label({
            style: {
                backgroundColor: "#" + color,
                padding: "4px 25px 4px 25px",
                margin: "0 0 0px 0",
                position: "bottom-center"
            }
        });

        var description = ui.Label({
            value: name,
            style: {
                margin: "0 0 0px 0px",
                position: "top-center",
                fontSize: "10px",
                padding: 0,
                border: 0,
                textAlign: "center",
                backgroundColor: "rgba(0, 0, 0, 0)"
            }
        });

        return ui.Panel({
            widgets: [colorBox, description],
            layout: ui.Panel.Layout.Flow("vertical"),
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        });
    }

    var names = ["Low", "", "", "", "High"];

    if (active_context.legend_panel === null) {
        active_context.legend_panel = ui.Panel({
            layout: ui.Panel.Layout.Flow("horizontal"),
            style: {
                position: "top-center",
                padding: "0px",
                backgroundColor: "rgba(255, 255, 255, 0.4)"
            }
        });

        active_context.legend_select = ui.Select({
            items: Object.keys(legend_styles),
            value: default_legend_style,
            onChange: function (key) {
                changeColorScheme(key, active_context);
            }
        });

        active_context.map.add(active_context.legend_panel);
    } else {
        active_context.legend_panel.clear();
    }

    active_context.legend_panel.add(active_context.legend_select);
    for (var i = 0; i < 5; i++) {
        active_context.legend_panel.add(
            makeRow(active_context.visParams.palette[i], names[i])
        );
    }
}

function buildLayerNames() {
    return [CLEAR_LABEL].concat(
        LAYER_DEFINITIONS.map(function (def) {
            return def.name;
        })
    );
}

function layerDefinitionByName(name) {
    for (var i = 0; i < LAYER_DEFINITIONS.length; i++) {
        if (LAYER_DEFINITIONS[i].name === name) {
            return LAYER_DEFINITIONS[i];
        }
    }
    return null;
}

function getCachedLayer(active_context, layerDefinition, year) {
    var key = year + "|" + layerDefinition.name;
    if (!active_context.layerCache[key]) {
        active_context.layerCache[key] = layerDefinition.build(year);
    }
    return active_context.layerCache[key];
}

function formatPointValue(value) {
    return typeof value === "number"
        ? String(Math.round(value * 100) / 100)
        : String(value);
}

var leftMap = ui.root.widgets().get(0);
var rightMap = ui.Map();
var linker = ui.Map.Linker([leftMap, rightMap]);
var splitPanel = ui.SplitPanel({
    firstPanel: linker.get(0),
    secondPanel: linker.get(1),
    orientation: "horizontal",
    wipe: true,
    style: { stretch: "both" }
});
ui.root.widgets().reset([splitPanel]);

var panel_list = [];
[
    [leftMap, "left"],
    [rightMap, "right"]
].forEach(function (mapside) {
    var active_context = {
        layerCache: {},
        currentYear: parseInt(DEFAULTYEAR, 10),
        last_layer: null,
        raster: null,
        datasetName: null,
        activeLayerDefinition: null,
        point_val: null,
        last_point_layer: null,
        map: mapside[0],
        legend_panel: null,
        legend_select: null,
        renderId: 0,
        visParams: {
            min: 0,
            max: 100,
            palette: legend_styles[default_legend_style]
        }
    };

    function updateVisParams() {
        if (active_context.last_layer !== null) {
            active_context.last_layer.setVisParams(active_context.visParams);
        }
    }

    active_context.updateVisParams = updateVisParams;
    active_context.build_legend_panel = function () {
        makeLegendPanel(active_context);
    };

    function clearLayer() {
        if (active_context.last_layer !== null) {
            active_context.map.remove(active_context.last_layer);
            active_context.last_layer = null;
        }
        if (active_context.last_point_layer !== null) {
            active_context.map.remove(active_context.last_point_layer);
            active_context.last_point_layer = null;
        }
        active_context.raster = null;
        active_context.datasetName = null;
        active_context.activeLayerDefinition = null;
        min_val.setValue("n/a", false);
        max_val.setValue("n/a", false);
        min_val.setDisabled(true);
        max_val.setDisabled(true);
        active_context.point_val.setValue("nothing clicked");
    }

    function loadLayer(layerName, done) {
        done = done || function () {};

        if (layerName === CLEAR_LABEL) {
            clearLayer();
            done();
            return;
        }

        var layerDefinition = layerDefinitionByName(layerName);
        var image = getCachedLayer(
            active_context,
            layerDefinition,
            active_context.currentYear
        );
        var renderId = ++active_context.renderId;

        if (active_context.last_layer !== null) {
            active_context.map.remove(active_context.last_layer);
            active_context.last_layer = null;
        }

        active_context.raster = image;
        active_context.datasetName = layerDefinition.name;
        active_context.activeLayerDefinition = layerDefinition;
        active_context.visParams.palette =
            legend_styles[
                active_context.legend_select.getValue() || default_legend_style
            ];
        active_context.build_legend_panel();

        detectRange(
            image,
            active_context.map.getBounds(true),
            layerDefinition.defaultRange,
            function (range) {
                if (renderId !== active_context.renderId) {
                    done();
                    return;
                }

                active_context.visParams = {
                    min: range.min,
                    max: range.max,
                    palette: active_context.visParams.palette
                };
                active_context.last_layer = active_context.map.addLayer(
                    image,
                    active_context.visParams,
                    layerDefinition.name
                );
                min_val.setValue(String(active_context.visParams.min), false);
                max_val.setValue(String(active_context.visParams.max), false);
                min_val.setDisabled(false);
                max_val.setDisabled(false);
                done();
            }
        );
    }

    active_context.map.style().set("cursor", "crosshair");

    var panel = ui.Panel({
        layout: ui.Panel.Layout.flow("vertical"),
        style: {
            position: "middle-" + mapside[1],
            backgroundColor: "rgba(255, 255, 255, 0.4)"
        }
    });

    var controls_label = ui.Label({
        value: mapside[1] + " controls",
        style: { backgroundColor: "rgba(0, 0, 0, 0)" }
    });

    var select = ui.Select({
        items: buildLayerNames(),
        placeholder: "Choose a dataset...",
        onChange: function (layerName, self) {
            self.setDisabled(true);
            loadLayer(layerName, function () {
                self.setDisabled(false);
            });
        }
    });

    var active_year = ui.Textbox({
        value: DEFAULTYEAR,
        style: { width: "200px" },
        onChange: function (value) {
            active_context.currentYear = parseInt(value, 10);
            var selected = select.getValue();
            if (selected && selected !== CLEAR_LABEL) {
                loadLayer(selected);
            }
        }
    });

    var min_val = ui.Textbox({
        value: "n/a",
        onChange: function (value) {
            active_context.visParams.min = +value;
            updateVisParams();
        }
    });
    min_val.setDisabled(true);

    var max_val = ui.Textbox({
        value: "n/a",
        onChange: function (value) {
            active_context.visParams.max = +value;
            updateVisParams();
        }
    });
    max_val.setDisabled(true);

    active_context.point_val = ui.Textbox({ value: "nothing clicked" });

    var range_button = ui.Button("Detect Range", function (self) {
        if (
            active_context.raster === null ||
            active_context.activeLayerDefinition === null
        ) {
            return;
        }

        self.setDisabled(true);
        var label = self.getLabel();
        self.setLabel("Detecting...");

        detectRange(
            active_context.raster,
            active_context.map.getBounds(true),
            active_context.activeLayerDefinition.defaultRange,
            function (range) {
                min_val.setValue(String(range.min), false);
                max_val.setValue(String(range.max), true);
                self.setLabel(label);
                self.setDisabled(false);
            }
        );
    });

    panel.add(
        ui.Label({
            value: "Current Year",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(active_year);
    panel.add(controls_label);
    panel.add(select);
    panel.add(
        ui.Label({
            value: "min",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(min_val);
    panel.add(
        ui.Label({
            value: "max",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(max_val);
    panel.add(range_button);
    panel.add(
        ui.Label({
            value: "picked point",
            style: { backgroundColor: "rgba(0, 0, 0, 0)" }
        })
    );
    panel.add(active_context.point_val);

    panel_list.push([panel, min_val, max_val, active_context]);
    active_context.map.add(panel);
    active_context.map.setControlVisibility(false);
    active_context.map.setControlVisibility({ mapTypeControl: true });
    active_context.build_legend_panel();
});

var clone_to_right = ui.Button("Use this range in both windows", function () {
    panel_list[1][1].setValue(panel_list[0][1].getValue(), false);
    panel_list[1][2].setValue(panel_list[0][2].getValue(), true);
});

var clone_to_left = ui.Button("Use this range in both windows", function () {
    panel_list[0][1].setValue(panel_list[1][1].getValue(), false);
    panel_list[0][2].setValue(panel_list[1][2].getValue(), true);
});

panel_list.forEach(function (panel_array) {
    var map = panel_array[3].map;
    map.onClick(function (obj) {
        var point = ee.Geometry.Point([obj.lon, obj.lat]);

        [panel_list[0][3], panel_list[1][3]].forEach(function (active_context) {
            if (active_context.raster === null) {
                return;
            }

            active_context.point_val.setValue("sampling...");
            var point_sample = active_context.raster.sampleRegions({
                collection: ee.FeatureCollection(point),
                geometries: true,
                scale: ERA5_SCALE_METERS
            });

            ee.data.computeValue(point_sample, function (val) {
                if (val.features.length > 0) {
                    var feature = val.features[0];
                    active_context.point_val.setValue(
                        formatPointValue(feature.properties.B0)
                    );

                    if (active_context.last_point_layer !== null) {
                        active_context.map.remove(
                            active_context.last_point_layer
                        );
                    }

                    active_context.last_point_layer =
                        active_context.map.addLayer(point, {
                            color: "#FF00FF"
                        });
                } else {
                    active_context.point_val.setValue("nodata");
                }
            });
        });
    });
});

panel_list[0][0].add(clone_to_right);
panel_list[1][0].add(clone_to_left);
