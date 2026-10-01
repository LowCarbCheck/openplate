# Moved: these units are in `docker/quadlet/core/`

This folder only points elsewhere. The units for the app, openplate-core and Postgres are in [`docker/quadlet/core/`](../core/README.md) now, generated from `docker/topologies/compose.core.yml`. The unit that was `sync.container` is `core.container`, and your `sync.env` is `core.env`.

If you installed from this folder, [Renamed units](../core/README.md#install) in that README lists the commands that move an existing install across without touching its data. This folder goes away in a later release.
