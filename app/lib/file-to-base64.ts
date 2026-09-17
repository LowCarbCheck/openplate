/**
 * A `File` into the raw base64 a provider's image part carries.
 *
 * LIFTED OUT OF `/scan` (M233/02) because `/pantry` photographs a shelf
 * through the same adapters and needs the same bytes. It is a pure-ish browser
 * utility with no opinion about what the picture shows, which is why it is a
 * `lib` module rather than something either route owns.
 *
 * NO `data:...;base64,` PREFIX in the result: every adapter composes its own
 * wrapper around the payload, and a prefix carried in here would arrive
 * doubled in one of them.
 *
 * Browser-only (`FileReader`), like everything on the intake path.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = reader.result;
      if (result === null || result instanceof ArrayBuffer) {
        reject(new Error('Failed to read photo.'));
        return;
      }
      const commaIndex = result.indexOf(',');
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read photo.')));
    reader.readAsDataURL(file);
  });
}
