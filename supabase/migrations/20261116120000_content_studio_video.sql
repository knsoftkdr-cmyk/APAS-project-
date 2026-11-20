-- Content Studio Phase 3: allow the browser-made lesson video ("video") output.
alter table content_outputs drop constraint if exists content_outputs_format_check;
alter table content_outputs
  add constraint content_outputs_format_check check (format in ('pptx', 'mermaid', 'flashcards', 'audio', 'video'));
