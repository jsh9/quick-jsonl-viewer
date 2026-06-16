# Sample Data

This directory is for local JSONL files used while manually testing Quick JSONL Viewer.

Run `generate_large_jsonl.py` to create `large-placeholder.jsonl`, a large JSONL file with repeated placeholder records. The generated `.jsonl` files are ignored by Git so local test data does not get committed accidentally.

```sh
python3 sample-data/generate_large_jsonl.py
```
