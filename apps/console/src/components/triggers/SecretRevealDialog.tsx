import { type ReactNode, useRef } from 'react';
import { KeyRound, Link2, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { TriggerReveal } from '../../lib/triggers';
import { CopyButton } from '../ui/CopyButton';
import { useDialog } from '../ui/useDialog';

/**
 * Modal "COPIA ESTO AHORA": muestra el material de auth (secreto HMAC + URL, o URL con token) UNA sola
 * vez, al crear o rotar un trigger. Es el punto critico de UX: al cerrar, el secreto/token ya no es
 * accesible desde la UI (el backend nunca lo re-expone), asi que:
 *  - La advertencia es DESTACADA (banner ambar, no un gris chico).
 *  - El boton de copiar del secreto es PROMINENTE (CopyButton variant="primary").
 *  - NO se cierra con Escape ni con click en el fondo: perder el secreto es destructivo, se exige un
 *    click explicito en "Ya lo copie". (Distinto del resto de dialogos, que si cierran con Escape.)
 *  - Atrapa el foco (Tab cicla dentro del modal) y lo devuelve al cerrar, por accesibilidad.
 *
 * El secreto vive solo en el estado de React del padre; este componente no lo persiste ni lo loguea.
 */
export function SecretRevealDialog({
  reveal,
  context,
  onClose,
}: {
  reveal: TriggerReveal;
  /** De donde viene el material: recien creado o rotado (cambia el copy del subtitulo). */
  context: 'created' | 'rotated';
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Foco inicial en el boton de cerrar (accion segura, no un campo editable), trampa de Tab dentro
  // del modal y restauracion del foco al cerrar, via el hook compartido. `closeOnEscape=false` a
  // proposito: perder el secreto es destructivo, se exige el click explicito en "Ya lo copie".
  const dialogRef = useDialog({ onClose, closeOnEscape: false, initialFocus: closeRef });

  const subtitle =
    context === 'created'
      ? 'Tu trigger quedo creado. Guarda esto antes de cerrar.'
      : 'Rotaste el secreto. El anterior ya no sirve: guarda el nuevo antes de cerrar.';

  const warning =
    reveal.authMode === 'hmac'
      ? 'Este es el unico momento en que veras el secreto HMAC. No se vuelve a mostrar. Si lo pierdes, tendras que rotarlo (y actualizar tu sistema).'
      : 'Este es el unico momento en que veras la URL con el token. No se vuelve a mostrar. Si la pierdes, tendras que rotar el token (y actualizar tu sistema).';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8">
      {/* Fondo inerte a proposito: sin onClick, para no descartar el secreto por accidente. */}
      <div className="absolute inset-0 bg-ink/50" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="secret-reveal-title"
        aria-describedby="secret-reveal-warning"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover"
      >
        <div className="flex items-start gap-3 border-b border-line-soft px-6 py-5">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brasa-soft text-brasa">
            {reveal.authMode === 'hmac' ? (
              <ShieldCheck className="h-5 w-5" />
            ) : (
              <Link2 className="h-5 w-5" />
            )}
          </span>
          <div>
            <h2 id="secret-reveal-title" className="font-display text-lg font-bold text-ink">
              Copia esto ahora
            </h2>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 py-6">
          {/* Advertencia DESTACADA: no es un texto gris, es un banner que no se puede ignorar. */}
          <div
            id="secret-reveal-warning"
            className="flex items-start gap-3 rounded-xl border border-[#E0A100]/40 bg-[#FBF3D9] px-4 py-3"
          >
            <TriangleAlert className="mt-0.5 h-5 w-5 flex-none text-[#9A6B00]" />
            <p className="text-sm font-medium leading-relaxed text-[#7A5600]">{warning}</p>
          </div>

          {reveal.authMode === 'hmac' ? (
            <>
              <SecretValue
                icon={<Link2 className="h-4 w-4" />}
                label="URL del webhook"
                value={reveal.webhookUrl}
                hint="Configura tu sistema para hacer POST a esta URL cuando ocurra el evento."
              />
              <SecretValue
                icon={<KeyRound className="h-4 w-4" />}
                label="Secreto HMAC"
                value={reveal.hmacSecret}
                hint="Firma cada peticion con este secreto. No se guarda en claro ni se vuelve a mostrar."
                prominent
              />
              <SignatureGuide reveal={reveal} />
            </>
          ) : (
            <SecretValue
              icon={<Link2 className="h-4 w-4" />}
              label="URL del webhook (con token)"
              value={reveal.webhookUrl}
              hint="Pega esta URL en tu sistema. El token viaja en la URL: tratala como un secreto y no la compartas."
              prominent
            />
          )}
        </div>

        <div className="flex justify-end border-t border-line-soft px-6 py-4">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-[10px] bg-brasa px-[22px] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(31,30,28,0.10)] transition hover:bg-brasa-hover"
          >
            Ya lo copie
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fila de un valor sensible: etiqueta, caja monoespaciada con el valor y boton de copiar. */
function SecretValue({
  icon,
  label,
  value,
  hint,
  prominent = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  /** El valor mas critico (el secreto): caja resaltada y boton de copiar prominente. */
  prominent?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
        <span className="text-muted">{icon}</span>
        {label}
      </div>
      <div className="flex items-stretch gap-2">
        <code
          className={[
            'min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border px-3.5 py-2.5 font-mono text-[13px] text-ink',
            prominent ? 'select-all border-brasa-line bg-brasa-soft' : 'select-all border-line bg-field',
          ].join(' ')}
        >
          {value}
        </code>
        <CopyButton
          text={value}
          variant={prominent ? 'primary' : 'default'}
          className={prominent ? '' : 'px-3.5'}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted">{hint}</p>
    </div>
  );
}

/** Guia de firma para HMAC: los nombres de header y el formato que el sistema externo debe mandar. */
function SignatureGuide({ reveal }: { reveal: Extract<TriggerReveal, { authMode: 'hmac' }> }) {
  const { signature } = reveal;
  const rows: Array<{ term: string; value: string }> = [
    { term: 'Algoritmo', value: signature.algorithm },
    { term: 'Cuerpo firmado', value: signature.signedPayload },
    { term: 'Header de firma', value: `${signature.signatureHeader}: ${signature.signatureFormat}` },
    { term: 'Header de timestamp', value: `${signature.timestampHeader} (Unix en segundos)` },
    { term: 'Ventana anti-replay', value: `${signature.toleranceSeconds}s` },
  ];
  return (
    <div className="rounded-xl border border-line bg-field px-4 py-3.5">
      <p className="text-sm font-medium text-ink">Como firmar cada peticion</p>
      <p className="mt-1 text-xs text-muted">
        Tu sistema calcula el HMAC del cuerpo y lo manda en estos headers. Sin firma valida, el webhook
        responde 401.
      </p>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.term} className="grid grid-cols-[132px_1fr] items-start gap-3">
            <dt className="text-xs text-muted">{row.term}</dt>
            <dd className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs text-ink">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
