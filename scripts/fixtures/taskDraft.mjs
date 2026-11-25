export const draft = (text, description = "", priority = 2) => ({
  text,
  description,
  priority,
  attachments: [],
  due: null,
});
