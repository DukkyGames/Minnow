function isTransientFetchError(err) {
  if (!(err instanceof TypeError)) return false;
  const message = err.message;
  return message.includes("Failed to fetch") || message.includes("NetworkError");
}
async function retryOnceOnTransientFetch(fn, delayMs = 400) {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientFetchError(err)) {
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fn();
  }
}
export {
  isTransientFetchError,
  retryOnceOnTransientFetch
};
