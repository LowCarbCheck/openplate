export type BaseHandle = {
  /**
   * Static English page title. Kept as the fallback for routes that haven't
   * been through string extraction yet — prefer `titleKey`.
   */
  title?: string;
  /**
   * i18n key for the page title (M129/05). The layout translates this when
   * present and falls back to `title` when it isn't, so a route can be
   * migrated one at a time.
   */
  titleKey?: string;
  backTo?: string;
};
