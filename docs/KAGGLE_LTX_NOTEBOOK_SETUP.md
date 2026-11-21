# Import and run the Ella2027 Kaggle LTX notebook

Notebook: `notebooks/Ella2027_Kaggle_LTX_Worker.ipynb`

1. In Kaggle, create a new notebook and enable **GPU** plus **Internet** in notebook settings.
2. Add a Kaggle secret named `ELLA_KAGGLE_WORKER_TOKEN`. Its value must match Render's `KAGGLE_LTX_WORKER_TOKEN`. Never put the token in a notebook cell or commit it to GitHub.
3. Import this `.ipynb` file into Kaggle (download it from GitHub, then use Kaggle's notebook import/upload flow).
4. Run the cells from top to bottom. The notebook checks the Render worker health, downloads the LTX distilled model, and starts polling the Ella2027 queue.
5. Leave the session running while jobs are being generated.

## Important limits

This is a first-pass LTX Diffusers setup, not a guarantee that the checkpoint will fit or run on every Kaggle GPU image. Kaggle free GPU availability, session duration, RAM/VRAM, package compatibility, and Hugging Face download availability are not guaranteed. The notebook deliberately caps each generation at five seconds and 576x320 for its initial T4 test. Extend duration/resolution only after a successful end-to-end test. The existing Render worker endpoints and Cloudinary signed upload flow are reused; no new provider key is required in Ella2027.

If the model-loading cell fails, copy the complete error output; do not rerun only the final worker cell because the model and callback must be loaded first.
