# Storage

All projects, assets, revisions and runs live in `data/pixelator.sqlite`; exports go to `data/exports/`. Set `PIXELATOR_DATA_DIR` to use another folder. For a backup, stop the app and copy the folder.

## Revisions

Every revision keeps the complete document, so any earlier state can be shown or restored. Rasters repeat heavily across frames and layers, which is why revisions are stored gzip-compressed. Revisions written by earlier versions are plain JSON text; they stay readable and are left as they are.

## Shrinking an older database

```powershell
npm run compact
```

Stop the app first and keep a copy of the data folder. The command packs every plain-text revision and returns the freed space to the file system; the content of each revision stays the same. On the database behind the README banners (26 revisions, the largest a 320×96 animation with 48 frames and 17 layers) it reduced the file from 579 MB to 3.3 MB.

Earlier versions of Pixelator cannot read packed revisions. A project file from the export window (`.pixelator.json`) stays plain JSON and can be imported anywhere.
