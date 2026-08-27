# Licensing scope and third-party components

The repository's [MIT License](LICENSE) covers its source code, original
documentation and original documentation assets, including the example images
under `docs/assets/examples`.

It does not cover, and this repository does not redistribute, any model
weights. Those are downloaded at install time from their own sources and carry
their own licences, which are recorded per component in
[`config/models.json`](config/models.json) and explained in
[`docs/MODELS.md`](docs/MODELS.md).

Draw Things and `draw-things-cli` are separate programs under
GPL-3.0-or-later. This project invokes `draw-things-cli` as an external process
and does not link against it or redistribute it.

The npm dependencies used by the source package retain their own licences.
Their exact versions and licence metadata are recorded in `package-lock.json`.
