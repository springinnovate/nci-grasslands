import json
import ee

BAD_STATES = {"FAILED", "CANCELLED"}


def init_ee():
    """Initalize earthengine api with authentication."""
    key_file = "/workdir/secrets/service-account-key.json"
    service_account = json.load(open(key_file))["client_email"]
    credentials = ee.ServiceAccountCredentials(service_account, key_file)
    ee.Initialize(credentials)


def main():
    """Entry point."""
    init_ee()

    current_task_list = {
        status.get("description"): status.get("state")
        for t in ee.batch.Task.list()
        if (status := t.status())
    }

    GRASSLAND_PROB_IC = ee.ImageCollection(
        "projects/global-pasture-watch/assets/ggc-30m/v1/nat-semi-grassland_p"
    )

    first_img = ee.Image(GRASSLAND_PROB_IC.first())
    proj = first_img.projection()

    info = {
        "image_count": GRASSLAND_PROB_IC.size(),
        "first_time_start_ms": GRASSLAND_PROB_IC.aggregate_min(
            "system:time_start"
        ),
        "last_time_start_ms": GRASSLAND_PROB_IC.aggregate_max(
            "system:time_start"
        ),
        "projection_crs": proj.crs(),
        "projection_transform": proj.transform(),
        "nominal_scale_m": proj.nominalScale(),
        "band_names": first_img.bandNames(),
        "first_image_id": first_img.get("system:index"),
    }

    print(ee.Dictionary(info).getInfo())
    # HMI_IMG = ee.Image(
    #     "projects/hm-30x30/assets/output/v20240801/HMv20240801_2022s_AA_300"
    # )
    # HII_IC = ee.ImageCollection("projects/HII/v1/hii")
    # ERA5_DATASET_IC = ee.ImageCollection("ECMWF/ERA5/MONTHLY")
    # SPEI_IC = ee.ImageCollection("CSIC/SPEI/2_10")
    # FLDAS_IC = ee.ImageCollection("NASA/FLDAS/NOAH01/C/GL/M/V001")
    # SOIL_ORGANIC_CARBON_IMG = ee.Image(
    #     "OpenLandMap/SOL/SOL_ORGANIC-CARBON_USDA-6A1C_M/v02"
    # )
    # SRTM_TOPO_DIVERSITY_IMG = ee.Image("CSP/ERGo/1_0/Global/SRTM_topoDiversity")
    # SRTM_MTPI_IMG = ee.Image("CSP/ERGo/1_0/Global/SRTM_mTPI")
    # MERIT_HYDRO_IMG = ee.Image("MERIT/Hydro/v1_0_1")

    for year in range(2000, 2024):
        grassland_p_img = GRASSLAND_PROB_IC.filterDate(
            f"{year}-01-01", f"{year}-12-31"
        ).first()
        description = f"nat_semi_grassland_p_{year}"
        if (
            current_state := current_task_list.get(description)
            not in BAD_STATES
        ):
            print(f"{description} found in task list as {current_state}")
        task = ee.batch.Export.image.toCloudStorage(
            image=grassland_p_img,
            description=description,
            bucket="ecoshard-root",
            fileNamePrefix=f"gee_export/{description}",
            region=grassland_p_img.geometry(),
            maxPixels=1e13,
            shardSize=256,
            fileDimensions=4096,
            skipEmptyTiles=True,
            fileFormat="GeoTIFF",
            formatOptions={"cloudOptimized": True},
        )
        task.start()
        print(f"started {description}")

    print("done")


if __name__ == "__main__":
    main()
