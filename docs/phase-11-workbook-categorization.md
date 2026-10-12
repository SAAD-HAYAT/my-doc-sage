# Phase 11 — Chat-generated files

> This phase follows the completed Phase 10 Excel ingestion work. It adds an
> explicit frontend exception for generating downloadable files through the
> existing chat composer.

## Goal

Let a signed-in user request Excel, PDF, or Markdown files in natural language.
When a specification is needed, replace the normal composer with two suggested
answers and a custom-answer field before generating the download.

## Decisions

- There is no dedicated categorization button. File-generation intent is
  detected from chat prompts containing an explicit create/generate verb and
  Excel, PDF, or Markdown format.
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
- The suggested categories are Production, Maintenance, Administration, and
  Logistics. Users can rename them and edit their descriptions before running
  the classification.
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
- A file request replaces the text composer with exactly two suggested answers
  and a third custom-answer input.
- Excel, PDF, and Markdown requests produce downloadable files after the user
  answers the clarification.
- A modern `.xlsx` source can infer common department-column names such as
  `Department`, `Dept`, `Section`, or `Cost Center`.
- Users can select the four suggested categories, use four existing values from
  a `Category` column, or enter four custom category names.
- The model must return one valid category assignment for every unique
  department; incomplete output fails instead of silently dropping rows.
- The downloaded workbook contains exactly four safely named worksheets and
  preserves all rows that have a department value on matching source sheets.
- Authentication is required for the classification endpoint.
