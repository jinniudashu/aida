# IdleX GEO Multi-Model Benchmark (GPT-5.4 Batch)

This directory contains an isolated benchmark harness for running the
`test/e2e/idlex-geo-v3.md` scenario against six LLM configurations.

Goals:
- keep results separate from historical `test/e2e/benchmark-results/`
- run preflight checks before any benchmark begins
- clean the remote test server before each run
- commit and push each model result immediately after completion
- produce a final six-model comparison report

Entry points:
- `./preflight.sh` - validate model strings, API keys, SSH, and remote prerequisites
- `./run-single-model.sh <model-id>` - run one model end-to-end and generate a report
- `./run-all-models.sh` - run all six models sequentially and build the comparison report

Provider verification:
- preflight now validates Gemini's configured API id and checks that the remote OpenClaw runtime actually registers `google-generative-ai` before any full benchmark starts
- this avoids spending 5-10 minutes on a doomed run caused by provider-id mismatch

Results are written to `test/e2e/model-benchmark-gpt5.4/results/<model-id>/`.
