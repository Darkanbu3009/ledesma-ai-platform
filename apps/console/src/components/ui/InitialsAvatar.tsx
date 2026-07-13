/**
 * AVATAR DE INICIAL reutilizable: circulo ink (#1F1E1C) con las iniciales en hueso (#F5F4EF, via
 * tokens bg-ink / text-cream). La derivacion replica la del encabezado de identidad de Mi cuenta
 * (nameInitials en ProfilePage, que no se toca por restriccion de ese PR): primera letra del primer
 * y del ultimo termino del nombre (una sola letra si el nombre tiene un unico termino). Si aun no
 * hay full_name, cae a la inicial del email. Pura y sin fetching: recibe los datos que la vista ya
 * conoce.
 */
function avatarInitials(fullName: string | undefined, email: string | undefined): string {
  const terms = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (terms.length > 0) {
    const first = terms.at(0)?.charAt(0) ?? '';
    const last = terms.length > 1 ? (terms.at(-1)?.charAt(0) ?? '') : '';
    return (first + last).toUpperCase();
  }
  return (email ?? '').trim().charAt(0).toUpperCase();
}

/**
 * `className` fija el tamano por uso (30px en el boton del footer, 36px en la cabecera del menu).
 * aria-hidden: el texto accesible lo pone el contenedor (nombre/email visibles al lado).
 */
export function InitialsAvatar({
  fullName,
  email,
  className,
}: {
  fullName: string | undefined;
  email: string | undefined;
  className: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex flex-none items-center justify-center rounded-full bg-ink font-medium tracking-[0.02em] text-cream ${className}`}
    >
      {avatarInitials(fullName, email)}
    </span>
  );
}
