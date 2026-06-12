# @ledesma-platform/widget-react

Wrapper React del widget embebible `<ledesma-agent>` de Ledesma AI Labs. Expone el componente
`<LedesmaAgent />` con props tipadas (camelCase) y las sincroniza con los atributos kebab-case
del custom element.

## Instalacion

Proximamente via npm:

```bash
npm install @ledesma-platform/widget-react
```

## Uso

El wrapper NO incluye el widget: el script de la plataforma define el custom element y debe
cargarse aparte (por ejemplo en el HTML de tu app):

```html
<script src="https://TU-PLATAFORMA.com/widget/ledesma-agent.js"></script>
```

Despues, en tu app React:

```tsx
import { LedesmaAgent } from '@ledesma-platform/widget-react';

export function Asistente() {
  return (
    <LedesmaAgent
      endpoint="https://TU-PLATAFORMA.com/v1/run/TU_AGENT_ID"
      tokenUrl="https://TU-BACKEND.com/api/token-agente"
      title="Asistente"
    />
  );
}
```

## Props

| Prop           | Atributo del elemento | Notas                                              |
| -------------- | --------------------- | -------------------------------------------------- |
| `endpoint`     | `endpoint`            | Requerido. Endpoint de ejecucion del agente.       |
| `tokenUrl`     | `token-url`           | Recomendado en produccion (tokens efimeros).       |
| `sessionToken` | `session-token`       | Token de sesion estatico.                          |
| `providerKey`  | `provider-key`        | Solo pruebas: la key queda visible en el cliente.  |
| `title`        | `title`               | Titulo del header del chat.                        |
| `placeholder`  | `placeholder`         | Placeholder del composer.                          |
| `className`    | `class`               | Clases CSS del elemento.                           |
| `style`        | `style`               | Estilos inline (React.CSSProperties).              |
