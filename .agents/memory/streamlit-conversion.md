---
name: Streamlit conversion
description: Runtime setup and compatibility notes for the Python dashboard conversion.
---

The root Streamlit app is intended for direct deployment with `streamlit run app.py` and uses bounded dependencies in `requirements.txt`.

**Why:** The project began as a React/Vite artifact, while Streamlit Community Cloud needs a root Python entry point and requirements file.

**How to apply:** Keep the synthetic signal contract and feature calculations in Python so future hardware adapters can replace only the reading source.