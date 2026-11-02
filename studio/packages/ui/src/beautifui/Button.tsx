// BeautifulUI's Button is the shadcn primitive — one source of truth.
export { Button, buttonVariants } from "../shadcn/button.js";
export type { ButtonProps } from "../shadcn/button.js";

/** Back-compat alias for the old exported type name. */
export type ButtonVariant = NonNullable<
  import("class-variance-authority").VariantProps<
    typeof import("../shadcn/button.js").buttonVariants
  >["variant"]
>;
