export function isInvalidZipError(message) {
  return /five-digit|postal ?code|zip code|invalid/i.test(message);
}

export function classifyRefreshError(message) {
  if (isInvalidZipError(message)) {
    return "That ZIP code looks invalid. Please update it.";
  }

  const genericMessage = message || "Unable to refresh nearby cats right now.";
  return /try updating your zip code|update it|zip code/i.test(genericMessage)
    ? genericMessage
    : `${genericMessage}${genericMessage.endsWith(".") ? "" : "."} Try updating your zip code.`;
}
