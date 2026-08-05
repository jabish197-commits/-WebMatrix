export const formatDate = (value) => new Intl.DateTimeFormat(undefined,{dateStyle:"medium"}).format(new Date(value));
