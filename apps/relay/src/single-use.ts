/**
 * Registro de USO UNICO de tokens del relay, EN MEMORIA (cero persistencia). Un token, una sesion de
 * relay: al abrir el canal se CONSUME su jti; un segundo intento con el mismo jti se rechaza. El jti se
 * retiene hasta la expiracion del token (<= 15 min); pasado eso el token ya no verifica igual, asi que
 * purgar es seguro y acota la memoria.
 *
 * Es autoritativo porque el relay corre como UNA instancia (ver docs/despliegue-relay.md): el estado de
 * uso unico y el rate limiting viven en este proceso. Escalar a N replicas exigiria estado compartido;
 * hoy no aplica y esta documentado.
 */
export class RegistroUsoUnico {
  private readonly consumidos = new Map<string, number>(); // jti -> exp epoch segundos

  /**
   * Intenta consumir un jti. Devuelve true si es la PRIMERA vez (canal autorizado); false si ya fue
   * consumido (reuso -> el llamador rechaza). Purga los vencidos en cada intento.
   */
  consumir(jti: string, expEpochSec: number, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
    this.purgar(nowSec);
    if (this.consumidos.has(jti)) return false;
    this.consumidos.set(jti, expEpochSec);
    return true;
  }

  private purgar(nowSec: number): void {
    for (const [jti, exp] of this.consumidos) {
      if (exp <= nowSec) this.consumidos.delete(jti);
    }
  }

  get tamano(): number {
    return this.consumidos.size;
  }
}
