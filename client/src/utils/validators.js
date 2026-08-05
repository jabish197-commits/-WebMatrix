export const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); export const isStrongPassword = (value) => typeof value === "string" && value.length >= 8;
