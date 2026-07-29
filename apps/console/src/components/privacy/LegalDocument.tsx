import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Logo } from '../brand/logo';
import type { BloqueLegal, DocumentoLegal, SeccionLegal } from '../../content/legal';

/**
 * Renderiza un DOCUMENTO LEGAL (aviso integral, aviso simplificado o terminos) como pagina PUBLICA: marca,
 * titulo, version, fecha y las secciones con su texto. No requiere sesion.
 *
 * El contenido llega como DATO (content/legal), nunca como children: asi el mismo texto se publica aqui,
 * se puede exportar y se testea sin montar la pagina entera.
 */

function Bloque({ bloque }: { bloque: BloqueLegal }) {
  if (bloque.tipo === 'parrafo') {
    return <p className="text-[15px] leading-[1.75] text-ink-soft">{bloque.texto}</p>;
  }
  if (bloque.tipo === 'lista') {
    return (
      <ul className="space-y-2">
        {bloque.items.map((item) => (
          <li key={item} className="flex gap-2.5 text-[15px] leading-[1.7] text-ink-soft">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-brasa" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="space-y-3">
      {bloque.items.map((item) => (
        <div key={item.termino} className="rounded-xl border border-line bg-field px-4 py-3">
          <dt className="text-sm font-semibold text-ink">{item.termino}</dt>
          <dd className="mt-1 text-[14.5px] leading-[1.7] text-muted">{item.descripcion}</dd>
        </div>
      ))}
    </dl>
  );
}

function Seccion({ seccion }: { seccion: SeccionLegal }) {
  return (
    <section id={seccion.id} className="scroll-mt-8">
      <h2 className="font-display text-lg font-bold tracking-tight text-ink">{seccion.titulo}</h2>
      <div className="mt-3 space-y-4">
        {seccion.bloques.map((bloque, index) => (
          <Bloque key={`${seccion.id}-${index}`} bloque={bloque} />
        ))}
      </div>
    </section>
  );
}

export function LegalDocument({ doc, footer }: { doc: DocumentoLegal; footer?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-cream px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <Link to="/" className="inline-flex items-center">
            <Logo tight className="h-10 w-auto" />
          </Link>
          <h1 className="mt-7 font-display text-3xl font-extrabold tracking-tight text-ink">
            {doc.titulo}
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">{doc.subtitulo}</p>
          <p className="mt-3 inline-flex items-center rounded-md bg-line-soft px-2.5 py-1 text-xs font-medium text-muted">
            {t('privacidad.aviso.versionFecha', { version: doc.version, fecha: doc.fecha })}
          </p>
        </header>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <div className="space-y-8">
            {doc.secciones.map((seccion) => (
              <Seccion key={seccion.id} seccion={seccion} />
            ))}
          </div>
        </div>

        {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}
