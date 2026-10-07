// IntlProvider wants { id: message }; lang/*.json keep the formatjs shape that lingua reads and writes.
export const compileMessages = (catalog: Record<string, { defaultMessage: string }>) =>
  Object.fromEntries(
    Object.entries(catalog).map(([id, { defaultMessage }]) => [id, defaultMessage]),
  );
