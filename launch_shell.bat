docker build -t ee-shell .
docker run --rm -it -v "%CD%:/workdir:ro" ee-shell
