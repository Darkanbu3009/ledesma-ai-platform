# Auditoria 13 - Clase de elemento: desempate y privacidad

- **Alcance**: el modelo de IDENTIDAD del aprendizaje colectivo. `claseDeElemento` y
  `estrategiasParaElAtlas` (`apps/worker/src/atlas-sitios.ts`), la lectura del DOM
  (`apps/worker/src/localizacion.ts`), y sus consumidores: barrera de identidad, sonda de interfaz,
  publicacion y consumo de plantillas compartidas.
- **Tipo**: fase 1 SOLO LECTURA con compuerta, y fase 2 de implementacion autorizada por esa
  compuerta. Ninguna migracion ni retiro de filas se ejecuto: el SQL de la seccion 6 se entrega para
  correrlo a mano.
- **Fecha**: 2026-09-07.
- **Metodo**: lectura del codigo real contra `path:linea`, medicion sobre fixtures ejecutados en
  jsdom (los mismos que quedaron como test de regresion) y verificacion del alcance por el codigo, no
  por suposicion.

---

## 1. Resumen ejecutivo

El modelo de clase de elemento tenia **dos defectos estructurales y una correccion relacionada**, los
tres medidos sobre fixtures y **ninguno ocurriendo en produccion** al momento de la auditoria:

1. **Dos controles distintos podian compartir clase.** `claseDeElemento` recorria primero TODOS los
   ejes de rol y devolvia en el primero que encontraba (`atlas-sitios.ts:186-191` antes del fix), asi
   que el `data-testid` propio de cada control -- que la lectura del DOM ya trae y que si esta en las
   estrategias -- nunca llegaba a mirarse. Dos botones "Eliminar ambiente" (pruebas y produccion)
   producian `click|rol:button|eliminar ambiente` los dos.
2. **La clase podia llevar dentro un dato de la tarea o contenido de pagina ajeno al control.** El eje
   de texto visible entraba tal cual, recortado a 60; `estrategiasParaElAtlas`
   (`atlas-sitios.ts:145-162` antes del fix) solo descartaba lo que coincidia con un valor TECLEADO de
   la corrida, y el contenido de la pagina no es un valor tecleado.
3. **La identidad podia ser el propio dato.** Un dia de calendario producia `click|rol:button|12`.

Las dos primeras contradicen invariantes ya declarados: la clase es la clave de `aprendizaje_sitios`
y el nombre de las ranuras de `plantillas_compartidas`, las dos tablas GLOBALES, y el invariante 1 del
atlas es el anonimato estructural (`atlas-sitios.ts:23-28`).

**Estado en una frase**: riesgos latentes reales con margen para corregirlos sin destruir conocimiento;
se corrigieron por cambio directo, y **ninguna de las 8 clases del atlas ni ninguno de los pasos de
las 2 plantillas cambia de forma**.

---

## 2. `claseDeElemento`: orden de ejes y consumidores

**El orden y el retorno temprano.** Tres pasadas sobre la lista de estrategias, cada una con su eje:
`rol` -> `atributo` (solo `aria-label` y `data-*`) -> `texto`. Cada pasada devuelve en su primer
acierto, y el criterio del orden es la ESTABILIDAD ENTRE USUARIOS, no la capacidad de distinguir: el
rol accesible y el nombre son lo que el sitio le promete a cualquier lector de pantalla. Ahi esta el
defecto 1: la estabilidad entre usuarios y la capacidad de distinguir dos controles no son la misma
propiedad, y el codigo asumia que si.

**Los siete consumidores** (todos derivan la clase de una lista de estrategias, nunca del DOM):

| Consumidor | Donde | Que hace con la clase |
| --- | --- | --- |
| Agregador del atlas | `atlas-sitios.ts`, `entradaDeAtlas` | es la clave de la fila que se escribe |
| Pistas por paso | `atlas-sitios.ts`, `pistasParaPaso` | busca la fila del paso |
| Barrera de identidad, camino receta | `ejecutor-receta.ts:422` | `claseDeclarada` contra las corroboradas |
| Barrera de identidad, camino motor libre | `tarea-web.ts:1479` | idem, sobre el control leido del DOM |
| Publicacion de plantillas | `packages/shared/.../plantillas/contrato.ts`, `esPublicable` | cada paso publica su clase; una ranura se NOMBRA por ella |
| Consumo de plantillas | `plantillas-compartidas.ts:521` | recalcula la clase de las estrategias del paso y exige que sea la declarada |
| Sonda de interfaz (pre-flight) | `sonda-interfaz.ts:128` | las clases observables que se buscan en la pagina |

De aqui sale la restriccion que decidio el diseno: **la clase tiene que ser funcion PURA de la lista
de estrategias**. Si la derivacion dependiera de algo que solo se sabe leyendo el DOM (por ejemplo un
parametro "hay un homonimo"), el consumo de plantillas recalcularia una clase distinta de la
declarada y ninguna plantilla aplicaria jamas. Por eso lo que la pagina MIDE viaja DENTRO de la
estrategia (`desempate`), y no como argumento de la funcion.

---

## 3. `ATRIBUTOS_A_LEER`: costo real de ampliarlo a `data-*` completo

Medido ejecutando el ayudante real `estrategiasDe` sobre seis fixtures en jsdom, una vez con la lista
de hoy (`data-testid, data-test, data-qa, data-cy, id, name, aria-label`) y otra leyendo todos los
`data-*`:

| Fixture | Hoy | Con `data-*` completo |
| --- | --- | --- |
| Gmail Redactar | 5 estrategias, 256 B | 10 estrategias, 582 B |
| Gmail Enviar | 5, 275 B | 7, 419 B |
| Panel con dos controles homonimos | 5, 333 B | 7, 465 B |
| Fila virtualizada con importe | 3, 190 B | 8, 515 B |
| Calendario | 4, 188 B | 7, 370 B |
| App con analitica pesada | 10, 563 B | 19, 1253 B |
| **Total** | **1805 B** | **3604 B (x2.00)** |

**El tamano no es el problema; lo que entra si.** Ampliar la lista de LECTURA tiene tres consecuencias
medidas, y las tres son peores que el defecto que se queria cerrar:

1. **Rompe el eje primario.** `sanearEstrategias` ordena por tipo (atributos primero) y corta en
   `MAX_ESTRATEGIAS_POR_PASO = 8`. En la app con analitica pesada, los `data-*` desplazan al `rol` y
   al `texto` fuera del corte y la clase pasa de `click|rol:button|pagar ahora` a
   `click|atributo:data-cy|pay`: exactamente la orfandad que la compuerta prohibe.
2. **Crea el defecto 2 en vez de cerrarlo.** En la fila virtualizada, la clase pasa de
   `click|atributo:data-testid|fila-factura` a `click|atributo:data-amount|12500.00`. El importe
   ASCIENDE a identidad.
3. **`esAtributoDeAtlas` ya admite CUALQUIER `data-*`**, asi que todo lo leido entraria derecho a la
   tabla global: `data-session-id=s_01JQ8Z9WQ2K3`, `data-user-hash=a3f9c2b18e4d5670`,
   `data-track-id=<uuid>`, `data-segment-props={"total":12500,...}`, `data-ved=0ahUKEwi1` (token por
   impresion de Google), `data-state=idle` (estado momentaneo).

**Decision**: los `data-*` completos se consultan **solo para desempatar**, y no se emiten como
estrategia. El costo de tamano se paga unicamente en el control homonimo, que es donde hay algo que
decidir. Y se agrega el criterio de admision de la seccion 5, sin el cual ningun `data-*` deberia
haber podido ser identidad.

---

## 4. `estrategiasParaElAtlas`: por que sobrevivia el contenido de pagina

Filtraba tres cosas -- tipo admitido, recorte a 60 y paranoia de VALORES TECLEADOS
(`estrategiasIndependientesDelValor`, aplicada al texto completo y al recortado) -- y ninguna alcanza
al contenido de la pagina: el importe de la factura de un tercero no lo tecleo nadie en esa corrida,
asi que la paranoia de valores no lo ve. El **recorte** era ademas parte del problema y no de la
solucion: recortar a 60 guarda un FRAGMENTO de lo que hubiera en la pagina y lo presenta como si
fuera un rotulo.

El criterio generico que lo cierra, sin una sola regla por sitio, es el de la seccion 5.

---

## 5. Criterio de admision (R2, R3 y R4)

Vive en el contrato (`packages/shared/src/recetas/contrato.ts`) porque lo aplican los dos lados: el
atlas y la publicacion de plantillas. Son dos reglas y no una porque la amenaza es distinta segun la
FUENTE del texto.

**Texto leido de la pagina** (nombre accesible, `aria-label`, texto visible) -- `esNombreDeIdentidad`:

1. no fue recortado (cabe en 60): un rotulo es corto, un texto que hay que cortar es un fragmento de
   contenido;
2. tiene al menos una letra: sin letras no nombra una funcion, es un valor;
3. **no tiene ningun digito**: los digitos entran con el dato (importes, fechas, identificadores) o
   con el estado de la pagina (contadores), que ademas cambia entre sesiones y rompe R4.

La regla 3 es deliberadamente asimetrica, con el mismo criterio que la censura: un falso positivo
pierde una clase legitima con un digito dentro ("Direccion linea 2") y ese control pasa a no tener
identidad, o sea que su paso escala al motor libre y se vuelve a aprender; un falso negativo escribe
el dato de un usuario en una tabla que se le sirve a todos los demas. Lo primero cuesta una corrida,
lo segundo no se deshace.

**Valor de un `data-*`** -- `esValorDeIdentidad`: acotado, con al menos una letra, sin la barra (que es
el separador de la clase) y con cada tramo alfanumerico siendo o solo letras o un numero de una o dos
cifras. Admite `eliminar-ambiente-produccion`, `checkout-pay`, `fila-2`; rechaza **por su sola forma**
`s_01JQ8Z9WQ2K3`, `a1b2c3d4-e5f6-7890-abcd-ef1234567890`, `a3f9c2b18e4d5670`, `0ahUKEwi1`,
`12500.00`, `2026-09-12`. Un digito suelto no descalifica un gancho porque ahi no es un dato: lo
escribio quien programo el sitio.

`aria-label` se juzga con la regla del texto de pagina, no con la del atributo: es el nombre accesible,
o sea texto que la pagina le muestra a un lector de pantalla, y ahi si entra el dato ("Eliminar
factura 4471").

**El desempate y R4.** Un atributo desempata solo si ademas de admisible es **unico entre los
homonimos**: eso descarta solo con la medicion, y sin ninguna lista, los atributos de estado
(`data-state=idle` es el mismo en los dos botones) y los de analitica compartida
(`data-analytics-id=btn_del_env`). Lo que queda fuera por R4, y por que: cualquier valor de sesion, un
contador, un identificador generado o el estado momentaneo del elemento cambian entre lecturas o entre
usuarios, asi que una identidad construida con ellos no encontraria lo que ella misma aprendio.

---

## 6. Deteccion de lo ya escrito (R3), para correr a mano

**NO se ejecuto nada.** Estas consultas son de SOLO LECTURA y se corren en el SQL Editor de Supabase,
igual que las migraciones de este repo.

Antes que nada, lo que **no se puede detectar**: el defecto 1 no deja rastro en la tabla. Dos controles
distintos fusionados en una clase producen UNA fila indistinguible de una fila sana (por eso la
consulta que agrupa por `(dominio, clase)` con `count > 1` devuelve cero: el indice unico lo impide por
construccion). Lo detectable es el defecto 2 y el 3.

```sql
-- 1. CLASES CON UN DATO DENTRO. El nombre de una clase es todo lo que sigue al SEGUNDO separador
--    (puede contener el separador, por eso se recorta con regexp y no con split_part).
--    Marca: nombre con digitos (importe, fecha, contador, identificador), nombre sin ninguna letra
--    (el numero de un dia de calendario) y nombre de 60 caracteres (fue RECORTADO: es un fragmento
--    de contenido de pagina, no un rotulo).
with clases as (
  select id,
         dominio,
         clase_de_elemento,
         corroboraciones,
         jsonb_array_length(origenes_hash) as origenes,
         regexp_replace(clase_de_elemento, '^[^|]*\|[^|]*\|', '') as nombre
  from aprendizaje_sitios
)
select id, dominio, clase_de_elemento, corroboraciones, origenes,
       case
         when char_length(nombre) >= 60 then 'recortada'
         when nombre !~ '[[:alpha:]]' then 'sin letras'
         else 'con digitos'
       end as motivo
from clases
where nombre ~ '[0-9]' or nombre !~ '[[:alpha:]]' or char_length(nombre) >= 60
order by dominio, clase_de_elemento;
```

```sql
-- 2. ESTRATEGIAS CON UN DATO DENTRO. La columna `estrategias` es tan global como la clase. Se mira el
--    texto que cada estrategia expone, con la regla de su fuente: 'rol' y 'texto' se juzgan como
--    texto de pagina (ningun digito); 'atributo' solo cuando es aria-label (los data-* admiten un
--    numero corto y se revisan aparte con la consulta 3).
select a.id, a.dominio, a.clase_de_elemento, e as estrategia
from aprendizaje_sitios a
cross join lateral jsonb_array_elements(a.estrategias) e
where (
        (e->>'tipo' in ('rol', 'texto') or (e->>'tipo' = 'atributo' and e->>'atributo' = 'aria-label'))
        and coalesce(e->>'nombre', e->>'texto', e->>'valor') ~ '[0-9]'
      )
   or char_length(coalesce(e->>'nombre', e->>'texto', e->>'valor', '')) >= 60
order by a.dominio, a.clase_de_elemento;
```

```sql
-- 3. ATRIBUTOS data-* CON FORMA DE IDENTIFICADOR: un tramo alfanumerico que mezcla letras y digitos,
--    o un numero de tres cifras o mas (uuid, hash, id de sesion, importe, fecha).
select a.id, a.dominio, a.clase_de_elemento, e->>'atributo' as atributo, e->>'valor' as valor
from aprendizaje_sitios a
cross join lateral jsonb_array_elements(a.estrategias) e
where e->>'tipo' = 'atributo'
  and e->>'atributo' <> 'aria-label'
  and (
        e->>'valor' ~ '[0-9]{3}'
        or e->>'valor' ~ '[[:alpha:]][0-9]|[0-9][[:alpha:]]'
        or e->>'valor' !~ '[[:alpha:]]'
      )
order by a.dominio, a.clase_de_elemento;
```

```sql
-- 4. PLANTILLAS COMPARTIDAS: la clase declarada de cada paso y el nombre de cada RANURA, que es una
--    clase tambien. Una fila que aparezca aqui publica un dato en el procedimiento que ejecutan
--    terceros.
select p.id, p.dominios_clave, p.codigo_de_intencion, p.estado,
       paso->>'idx' as idx,
       coalesce(paso->>'claseDeElemento', paso->'valor'->>'clase') as clase
from plantillas_compartidas p
cross join lateral jsonb_array_elements(p.pasos) paso
where regexp_replace(
        coalesce(paso->>'claseDeElemento', paso->'valor'->>'clase', ''),
        '^[^|]*\|[^|]*\|', ''
      ) ~ '[0-9]'
order by p.dominios_clave, idx;
```

### Procedimiento de retiro (tampoco se ejecuto)

**`aprendizaje_sitios`** no tiene columna de estado: retirar una fila es borrarla.

```sql
-- Con la lista de ids que devolvio la consulta 1, 2 o 3, y de a un dominio por vez.
delete from aprendizaje_sitios where id in ( ... );
```

El reaprendizaje no necesita nada mas: la escritura del atlas es un upsert sobre `(dominio, clase)`,
asi que la proxima corrida exitosa del motor libre sobre ese control vuelve a crear la fila, ya con la
derivacion corregida. Una fila borrada que ya no se pueda volver a derivar (porque su nombre llevaba
un dato) simplemente no vuelve, que es el resultado buscado.

**`plantillas_compartidas`** si tiene ciclo de vida, asi que **no se borra**: se retira.

```sql
update plantillas_compartidas set estado = 'retirada', actualizada_en = now() where id in ( ... );
```

`'retirada'` esta fuera de `ESTADOS_SERVIBLES`, asi que la fila deja de ofrecerse de inmediato, y el
mecanismo de REHABILITACION que ya existe la devuelve a `'candidata'` -- con la racha de fallos en 0,
los consumidores en `[]` y **los pasos reemplazados por los nuevos** -- cuando el motor libre vuelva a
publicar sobre su identidad
(`apps/backend/src/plantillas-compartidas/plantillas-compartidas-repository.ts:639-721`). O sea que el
retiro es reversible por aprendizaje y no hay que reconstruir nada a mano.

---

## 7. La compuerta: cuanto conocimiento se pierde

Estado verificado por SQL antes de la fase 1: `aprendizaje_sitios` con **8 clases**, todas de
mail.google.com, 7 servibles para todos los consumidores, **cero colisiones**, **una sola clase con eje
de texto** (`click|texto|redactar`, que es el nombre del control); `plantillas_compartidas` con **2
filas**, ambas de mail.google.com / enviar.

**Cuantas clases y cuantos pasos cambian de forma: cero.** No es una suposicion, sale de la propia
derivacion:

- **El segundo eje no puede aparecer en nada ya guardado.** Solo lo pone la LECTURA del DOM, dentro del
  campo `desempate` de la estrategia, y ninguna estrategia persistida lo lleva. Sin ese campo la
  derivacion es, linea por linea, la de siempre. Esto vale para las 8 filas del atlas, para los pasos
  de las 2 plantillas y para toda receta ya promovida.
- **La regla de admision no toca un nombre limpio.** Las clases que el propio repo ejercita
  (`click|rol:button|enviar`, `click|texto|redactar`, `escribir|rol:textbox|asunto`,
  `escribir|atributo:aria-label|destinatarios`, y las demas del mismo conjunto) no llevan digitos, no
  estan recortadas y tienen letras. La unica clase real con eje de texto es `click|texto|redactar`:
  entra sin cambios. El test de regresion de produccion fija los cinco controles del redactor de Gmail
  con su cadena exacta.
- **Si alguna de las 8 fuera una excepcion**, la consulta 1 de la seccion 6 la nombra ANTES de
  desplegar, y su costo es acotado: esa fila deja de refrescarse y su control escala al motor libre.

Lo que si cambia, y hay que decirlo: a partir de este cambio, un control cuyo rotulo lleve un digito
(`Direccion linea 2`) deja de tener clase. Su paso no entra al atlas, la barrera lo bloquea con
`clase_no_corroborada` y la tarea escala al motor libre. Es una perdida de aprendizaje, no de
correccion, y es recuperable en cuanto el sitio o el flujo ofrezcan otro eje limpio.

---

## 8. Las dos vias, y por que se eligio la directa

**VIA A, cambio directo de `claseDeElemento`.** Simple. Toda clase que cambiara de forma quedaria
huerfana: su fila del atlas dejaria de coincidir y su plantilla dejaria de aplicar hasta que el motor
libre reaprenda y republique.

**VIA B, derivacion versionada.** La clase lleva version, las viejas se siguen entendiendo para leer,
las nuevas se escriben corregidas y la convivencia se resuelve en la busqueda, como ya se resuelven las
variantes de interfaz. Mas codigo, cero perdida.

**Elegida: VIA A**, y el argumento es la seccion 7: con la derivacion propuesta el conjunto de clases
que cambia de forma es **vacio**, asi que la VIA B pagaria complejidad permanente -- una version en la
clave de dos tablas globales, en la barrera, en la sonda y en las dos puertas de plantillas -- para
proteger cero filas. Con un atlas grande el calculo se invierte: la recomendacion se sostiene sobre
8 clases y 2 plantillas, no en general.

---

## 9. Que quedo implementado

| Requisito | Donde |
| --- | --- |
| R1, segundo eje solo cuando el primero no distingue | `localizacion.ts` (`estrategiasDe` mide homonimos y atributos distintivos), `contrato.ts` (`desempate`), `atlas-sitios.ts` (`claseDeElemento`) |
| R1, homonimo sin nada que lo distinga | `desempate: null` -> el control no tiene identidad (falla cerrada) |
| R2, ninguna clase ni estrategia publicable con un dato | `esNombreDeIdentidad` / `esValorDeIdentidad` / `esAtributoDeIdentidad`, aplicadas en `claseDeElemento`, `estrategiasParaElAtlas` y `parsearEstrategiaPublicable` / `esPublicable` |
| R3, deteccion y retiro | seccion 6 de este documento, sin ejecutar |
| R4, estabilidad | el desempate exige atributo unico entre homonimos Y admisible por forma; nada de sesion, contador, identificador generado ni estado entra |
| Sonda | `sonda-interfaz.ts` parsea el segundo eje y exige el atributo al buscar candidatos |

Lo que **no** se toco, a proposito: la barrera de identidad no se relajo (el nombre de la clase sigue
siendo el nombre accesible, que es lo que compara), la verificacion determinista sigue sin consultar
nada de esto, y no hay ni una regla de sitio ni de dominio en ninguna de las reglas nuevas.
