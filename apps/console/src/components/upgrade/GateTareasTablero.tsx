import { Fragment } from 'react';

/**
 * Tablero semanal ESTATICO para el gate de Tareas programadas: prueba visual de "una semana asi"
 * con 3 tareas de ejemplo x 7 dias. Todo hardcodeado: sin calculo de fechas, sin timers, sin estado,
 * sin animacion. El "dia actual" (mié) y la celda "corriendo ahora" son marcas fijas de la maqueta.
 *
 * Paleta: verde #1D9E75 solo en marcas "ejecutada" y su item de leyenda; brasa #E5511E solo en la
 * celda "corriendo ahora" (unica) y el dot del dia actual. Resto neutros calidos. Sin box-shadow.
 */

type Marca = 'ejecutada' | 'corriendo' | 'programada' | null;

const DIAS: { label: string; actual?: boolean; finde?: boolean }[] = [
  { label: 'lun' },
  { label: 'mar' },
  { label: 'mié', actual: true },
  { label: 'jue' },
  { label: 'vie' },
  { label: 'sab', finde: true },
  { label: 'dom', finde: true },
];

const TAREAS: { nombre: string; horario: string; marcas: Marca[] }[] = [
  {
    nombre: 'Reporte de ventas',
    horario: 'dias habiles 7:30',
    marcas: ['ejecutada', 'ejecutada', 'corriendo', 'programada', 'programada', null, null],
  },
  {
    nombre: 'Cierre de facturas',
    horario: 'lunes 8:00',
    marcas: ['ejecutada', null, null, null, null, null, null],
  },
  {
    nombre: 'Respaldo de datos',
    horario: 'diario 23:00',
    marcas: [
      'ejecutada',
      'ejecutada',
      'programada',
      'programada',
      'programada',
      'programada',
      'programada',
    ],
  },
];

const marcaClass: Record<Exclude<Marca, null>, string> = {
  ejecutada: 'bg-[#1D9E75]',
  corriendo: 'bg-[#E5511E]',
  programada: 'border border-[#D3D1C7]',
};

const LEYENDA: { label: string; marca: Exclude<Marca, null> }[] = [
  { label: 'ejecutada', marca: 'ejecutada' },
  { label: 'corriendo ahora', marca: 'corriendo' },
  { label: 'programada', marca: 'programada' },
];

export function GateTareasTablero() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-[14px] border-[0.5px] border-[#E9E7DF] bg-white"
    >
      <div className="overflow-x-auto">
        <div className="grid min-w-[540px] grid-cols-[120px_repeat(7,minmax(0,1fr))] md:grid-cols-[170px_repeat(7,minmax(0,1fr))]">
          {/* Fila header: etiqueta + dias. Sab/dom llevan bg marfil en toda su columna. */}
          <div className="flex items-center border-b-[0.5px] border-[#F1EFE8] px-4 py-3 text-[11px] uppercase tracking-[0.07em] text-[#B4B2A9]">
            Una semana asi
          </div>
          {DIAS.map((dia) => (
            <div
              key={dia.label}
              className={`flex flex-col items-center justify-center border-b-[0.5px] border-[#F1EFE8] py-3 font-mono text-[11px] ${
                dia.finde ? 'bg-[#FAF9F5] text-[#B4B2A9]' : dia.actual ? 'font-medium text-ink' : 'text-[#5F5E5A]'
              }`}
            >
              <span>{dia.label}</span>
              {dia.actual && <span className="mt-1 h-1 w-1 rounded-full bg-[#E5511E]" />}
            </div>
          ))}

          {/* 3 filas de tarea: nombre + horario a la izquierda, marcas 9x9 por dia. */}
          {TAREAS.map((tarea, fila) => {
            const borde = fila < TAREAS.length - 1 ? 'border-b-[0.5px] border-[#F1EFE8]' : '';
            return (
              <Fragment key={tarea.nombre}>
                <div className={`flex min-w-0 flex-col justify-center px-4 py-3 ${borde}`}>
                  <span className="truncate text-[12.5px] font-medium text-ink">{tarea.nombre}</span>
                  <span className="hidden truncate font-mono text-[10.5px] text-[#8A8880] md:block">
                    {tarea.horario}
                  </span>
                </div>
                {DIAS.map((dia, col) => {
                  const marca = tarea.marcas[col] ?? null;
                  return (
                    <div
                      key={dia.label}
                      className={`flex items-center justify-center py-3 ${borde} ${
                        dia.finde ? 'bg-[#FAF9F5]' : ''
                      }`}
                    >
                      {marca && (
                        <span className={`h-[9px] w-[9px] rounded-[3px] ${marcaClass[marca]}`} />
                      )}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Barra final: leyenda + resumen mono. */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t-[0.5px] border-[#F1EFE8] bg-[#FAF9F5] px-4 py-[11px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {LEYENDA.map((item) => (
            <span key={item.label} className="flex items-center gap-2 text-[11.5px] text-[#5F5E5A]">
              <span className={`h-[9px] w-[9px] flex-none rounded-[3px] ${marcaClass[item.marca]}`} />
              {item.label}
            </span>
          ))}
        </div>
        <span className="font-mono text-[11.5px] text-[#8A8880]">
          12 corridas esta semana, 0 fallos, 0 intervenciones
        </span>
      </div>
    </div>
  );
}
