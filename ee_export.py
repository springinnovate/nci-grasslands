from collections import defaultdict
import json
import ee

BAD_STATES = {"FAILED", "CANCELLED", "CANCEL_REQUESTED"}


def init_ee():
    """Initalize earthengine api with authentication."""
    key_file = "/workdir/secrets/service-account-key.json"
    service_account = json.load(open(key_file))["client_email"]
    credentials = ee.ServiceAccountCredentials(service_account, key_file)
    ee.Initialize(credentials)


def main():
    """Entry point."""
    init_ee()

    task_statuses = defaultdict(set)
    for task in ee.batch.Task.list():
        status = task.status()
        task_statuses[status["description"]].add(status["state"])
    print(task_statuses)

    GRASSLAND_PROB_IC = ee.ImageCollection(
        "projects/global-pasture-watch/assets/ggc-30m/v1/nat-semi-grassland_p"
    )

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
        good_states = task_statuses.get(description) - BAD_STATES
        if good_states:
            print(
                f"{description} doesn't need to be restarted because it's in {good_states}"
            )
            continue
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
        )
        task.start()
        print(f"started {description}")

    print("done")


if __name__ == "__main__":
    main()
