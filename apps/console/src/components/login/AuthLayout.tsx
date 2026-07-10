import type { ReactNode } from 'react';
import { BrandPanel, BrandCopy } from './BrandPanel';
import { LedesmaLogo } from './LedesmaLogo';

/**
 * Layout de marca de las pantallas de acceso, con panel dividido estilo
 * laboratorio: panel izquierdo de marca con la nube ditherizada (solo desktop
 * >=1024px) y panel derecho con el contenido. En movil colapsa a columna
 * unica: header compacto con el logo, contenido centrado y el bloque de marca
 * como texto al pie, sin canvas.
 *
 * `sent` se propaga a BrandPanel para disparar el pulso de la nube al enviar.
 * Lo usan las pantallas de recuperacion de contrasena; LoginPage y SignUpPage
 * conservan su copia previa de este mismo shell.
 */
export function AuthLayout({ sent, children }: { sent: boolean; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-cream lg:flex">
      {/* Panel izquierdo de marca (solo desktop), separado por hairline de 0.5px. */}
      <aside
        className="hidden lg:block lg:w-[52%]"
        style={{ borderRight: '0.5px solid rgba(31,30,28,0.14)' }}
      >
        <BrandPanel sent={sent} />
      </aside>

      {/* Panel derecho: contenido centrado. En movil, columna unica con header
          compacto arriba y el bloque de marca al pie. */}
      <div className="flex min-h-screen flex-1 flex-col lg:min-h-0">
        <header className="flex justify-center pt-12 lg:hidden">
          <LedesmaLogo compact />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>
        <footer className="flex justify-center px-6 pb-12 lg:hidden">
          <BrandCopy />
        </footer>
      </div>
    </div>
  );
}
