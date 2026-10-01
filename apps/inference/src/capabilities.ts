/**
 * What this service can and cannot do, told to the client.
 *
 * `GET /v1/models` returns this object on the model entry. A client reads it
 * before it sends a request, so it does not ask for something this service
 * cannot give. Extra keys on a model entry are harmless to OpenAI-style
 * clients, so this does not break the OpenAI shape.
 */
import { z } from 'zod';

export const CapabilitiesSchema = z.object({
  /**
   * Which tasks this service can do. A task set to `false` is not served here,
   * and a client should send it somewhere else.
   */
  tasks: z.object({
    /** Identify the foods on a plate from one photo. This is the only task served today. */
    plateImage: z.boolean(),
    /** Turn a typed description of a meal into foods. */
    describe: z.boolean(),
    /** Read a pantry item from a photo. */
    pantryImage: z.boolean(),
    /** Read a pantry item from typed text. */
    pantryText: z.boolean(),
    /** Suggest recipes. */
    recipes: z.boolean(),
  }),
  /**
   * How well the service fills the caution flags on each food (for example an
   * allergen or a diet warning).
   * `none`: it fills no flags, so a client must not treat an empty flag list as "safe".
   * `partial`: it fills some flags, not all.
   * `complete`: it fills every flag.
   * This service is `partial`: it lists what it can recognise from the food
   * name (`pipeline/food-flags.ts`). A food it does not recognise has no
   * `flags` key, which means "not assessed", and a food it does recognise may
   * still contain something its name does not show.
   */
  flags: z.enum(['none', 'partial', 'complete']),
  /**
   * Which languages the service can translate food names into.
   * `none`: names come back in one language only.
   * `request-language`: names come back in the language the request asks for.
   * `all`: names come back in every supported language at once.
   * This service is `request-language`: when the `Accept-Language` header names
   * an app language other than English, each food gets `translations` with its
   * English name and its name in that one language
   * (`pipeline/translate-names.ts`). `name` stays English. A failed translation
   * leaves every food without `translations`, so a client must still handle a
   * food that has none.
   */
  translations: z.enum(['none', 'request-language', 'all']),
  /**
   * Whether the service reads a printed nutrition panel on a package and
   * returns its numbers as `macroSource: 'label'`.
   */
  labels: z.boolean(),
});

export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/** What the one model, `openplate-plate-1`, can do today. */
export const PLATE_MODEL_CAPABILITIES: Capabilities = {
  tasks: {
    plateImage: true,
    describe: false,
    pantryImage: false,
    pantryText: false,
    recipes: false,
  },
  flags: 'partial',
  translations: 'request-language',
  labels: false,
};
