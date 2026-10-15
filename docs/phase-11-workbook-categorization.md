# Phase 11 — Chat-generated files

> This phase follows the completed Phase 10 Excel ingestion work. It adds an
> explicit frontend exception for generating downloadable files through the
> existing chat composer.

## Goal

Let a signed-in user request Excel, PDF, or Markdown files in natural language.
Ask the model whether a material specification is missing. Only when the model
requests clarification, replace the normal composer with the model-authored
question, two model-authored suggested answers, and a custom-answer field.

## Decisions

- There is no dedicated categorization button. File-generation intent is
  detected from chat prompts containing an explicit create/generate verb and
  Excel, PDF, or Markdown format.
- Every detected file request first receives a validated model plan. A ready
  plan generates immediately; a clarification plan controls the temporary
  composer. The frontend does not infer missing detail or provide fixed
  clarification wording.
- General generated files use relevant document passages retrieved for the
  authenticated user. Excel responses use a validated worksheet/row structure;
  PDF and Markdown responses use model-authored Markdown content.
- Generated Excel and PDF bytes are built in the browser and offered as an
  immediate download plus a repeat-download button in the assistant message.
- Generated files and their object URLs are session-only and are not stored in
  Supabase or restored from chat history.
- For workbook categorization, the source workbook is retained in the current
  browser session after upload. It is not sent to the classification endpoint.
- Only the unique department names and four user-editable category definitions
  are sent to the model.
- For categorization, the model resolves the user's request and clarification
  answers into either four named categories or an instruction to use four
  values already present in a `Category` column.
- The first populated row of each worksheet is treated as its header row.
  Worksheets without the selected department column are ignored.
- All categorized data rows are retained; the RAG ingestion limits do not apply
  because the resulting workbook is downloaded rather than embedded.
- Output is value-only so moved formulas cannot retain broken source-cell
  references. Formula cached results are used when available.
- Every output row includes its source worksheet and original row number.

## Acceptance criteria

- No standalone Excel-generation or categorization control appears in the top
  bar. The workflow starts only from a chat prompt.
- A file request leaves the normal composer in place when the model says it is
  ready to proceed.
- Only a model `clarify` decision replaces the composer, using exactly two
  model-authored suggestions and a model-authored custom-input hint.
- Excel, PDF, and Markdown requests produce downloadable files immediately when
  ready, or after the user supplies any clarification the model requires.
- A modern `.xlsx` source can infer common department-column names such as
  `Department`, `Dept`, `Section`, or `Cost Center`.
- Users can select either model-authored category suggestion, use four existing
  values from a `Category` column when offered, or type a custom answer.
- The model must return one valid category assignment for every unique
  department; incomplete output fails instead of silently dropping rows.
- The downloaded workbook contains exactly four safely named worksheets and
  preserves all rows that have a department value on matching source sheets.
- Authentication is required for the classification endpoint.
