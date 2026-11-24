# Mercado Raíz — Guía de negocio

*Documento para perfiles de negocio: qué hace la aplicación, quién hace qué
y cómo fluye el trabajo del día a día. Sin tecnicismos.*

---

## Qué es

**Mercado Raíz** es el panel de control de reposición de un retailer de
alimentos ("del campo a tu mesa"). Responde tres preguntas que hoy se
responden tarde o a ojo:

1. **¿Qué se está por quedar sin stock?** — y cuánta plata deja de ganar
   el local por cada día de góndola vacía.
2. **¿Qué hay que pedir, a quién y cuánto?** — un agente automático
   propone la orden de compra completa: proveedor más conveniente
   (precio vs. demora) y cantidad calculada según la demanda real.
3. **¿Quién lo aprueba y en qué estado está?** — nada *grande* se
   compra sin validación humana, y cada orden se sigue hasta que el
   camión descarga y el stock sube.

La promesa: **menos góndolas vacías, menos plata clavada en mercadería
que no rota, y decisiones de compra con números a la vista.**

## El ciclo completo, en una mirada

```
Se vende y el stock baja
        │
        ▼
El sistema detecta el riesgo de quiebre
        │
        ▼
Se genera una Orden de Compra (OC)
  • automática: el agente la propone, o
  • manual: el comprador la crea desde una alerta
        │
        ▼
Si supera $50.000 → espera aprobación humana
Si es menor       → se aprueba sola
(las OCs que crea el comprador a mano
siempre esperan aprobación, cualquiera
sea el monto)
        │
        ▼
Se marca como enviada al proveedor
        │
        ▼
Llega el camión → se registra la recepción
        │
        ▼
El stock sube y el quiebre se resuelve
```

Cada paso queda registrado: quién aprobó, quién marcó el envío, quién
recibió, cuántas unidades llegaron (si llegaron menos de lo pedido,
la diferencia queda anotada).

## Las alertas: que nadie tenga que ir a buscarlas

Las alertas **salen al encuentro del usuario**:

- **La campanita** (arriba a la derecha, en todas las pantallas) muestra
  las alertas graves sin abrir nada — un punto rojo con el conteo. Un
  clic lleva directo a la pantalla donde se resuelve.
- **El comprador**, en cambio, entra directamente a su bandeja de
  alertas: esa es su pantalla de inicio y su lista de trabajo diaria.

Tipos de alerta que genera el sistema (se re-evalúan ~cada hora
mientras alguien las consulta — la campanita las refresca sola):

| Alerta | Qué significa | Gravedad |
|---|---|---|
| **Quiebre** | Stock en cero con demanda activa — se está perdiendo venta ahora | Alta |
| **Riesgo por demora** | El stock alcanza para menos días de lo que tarda el proveedor en entregar | Alta/Media |
| **Stock muerto** | Mercadería parada hace más de 90 días — plata inmovilizada | Baja |
| **Orden pendiente** | Una OC lleva más de 48 horas esperando aprobación | Media |

## Los roles

### GERENTE — *el dueño del local*

**Quién es**: Carlos Martínez (`carlos.martinez@mercadorai.com`).
Responsable del punto de venta. Su palabra corrige lo que el sistema
cree que hay en la góndola.

**Qué ve**: todo el negocio — Dashboard de órdenes, Quiebres, Métricas
y la campanita con las alertas graves.

**Qué hace día a día**:

- **Registra ventas** desde la tabla de quiebres (la venta descuenta
  stock; si el teórico ya era cero, queda negativo — señal de que el
  conteo físico diverge y hay que ajustar).
- **Ajusta el stock** con el conteo real de góndola/depósito o con
  mermas y roturas — la corrección queda registrada con motivo.
- **Aprueba, envía y recibe órdenes** — tiene los mismos poderes sobre
  las OCs que la aprobadora (es backup de su rol).
- Mira la **campanita**: las alertas graves le llegan solas.

**Su superpoder**: es el único (junto a ADMIN) que puede *corregir* el
stock — el sistema miente si la realidad miente, y el gerente es quien
pone los datos a la verdad con el conteo.

### APROBADOR — *el control de la billetera*

**Quién es**: María López (`maria.lopez@mercadorai.com`). Nada grande
sale sin su firma.

**Qué ve**: lo mismo que el gerente en pantallas (Dashboard, Órdenes,
Quiebres, Métricas, campanita) — pero su centro de gravedad es la
bandeja de **órdenes pendientes de aprobación**.

**Qué hace día a día**:

- Revisa las OCs que esperan decisión: producto, proveedor, cantidad,
  monto y el **análisis del agente** que la propuso.
- **Aprueba** (la OC avanza) o **rechaza** (muere ahí, nada se compra).
- **Marca el envío** al proveedor una vez comunicada la OC.
- **Registra la recepción** cuando llega el camión — ahí el stock sube
  y, si llegó menos de lo pedido, el faltante queda medido para
  reclamarle al proveedor.
- Las órdenes sobre productos en quiebre aparecen como **urgentes** en
  su campanita — son las que más apuran.

**Su superpoder**: es el freno humano del agente automático. El robot
propone; María decide.

### BUYER (Comprador) — *la bandeja de entrada del abastecimiento*

**Quién es**: Laura Fernández (`buyer@mercadorai.com`). Rol de foco
único y deliberado: **no ve nada más que sus alertas**.

**Qué ve**: una sola pantalla — el dashboard de alertas con filtro por
tipo y un interruptor de "solo no leídas". Ni dashboard de órdenes, ni
proveedores, ni métricas: cero distracciones.

**Qué hace día a día**:

- Recorre su cola de alertas pendientes.
- En cada una puede pedir una **sugerencia de compra**: el sistema le
  muestra los proveedores del producto con precio y demora de cada uno,
  más la cantidad sugerida calculada por la demanda.
- Con un clic en **"Comprar"** genera la OC real — que cae pendiente de
  aprobación en la bandeja de María — y la alerta queda atendida en el
  mismo gesto (si la OC falla, la alerta vuelve: nada se pierde).
- Marca alertas leídas a medida que las atiende.

**Su superpoder**: convierte cada señal de problema en una compra
concreta, sin salir de una sola pantalla.

### ADMIN — *el administrador del sistema*

**Quién es**: (`admin@mercadorai.com`). Ve todo lo que ven los demás
roles y además administra el sistema.

**Qué ve**: todas las pantallas — Dashboard, Órdenes, Quiebres,
Métricas, **Usuarios** y **Proveedores** (estas dos solo para él).

**Qué hace**:

- Todo lo del gerente y la aprobadora (ventas, ajustes, OCs completas).
- **Gestiona usuarios**: altas, cambios de rol, activar/desactivar.
- **Gestiona proveedores**: altas, datos de contacto, condiciones de
  entrega (demora estimada, pedido mínimo, costo de envío) y
  activar/desactivar.
- Auditoría: puede leer y operar la cola de alertas del comprador
  (la pantalla es del BUYER, pero el acceso a los datos queda
  habilitado para supervisión).

### SERVICIO — *la cuenta del robot*

**Quién es**: la cuenta "Agente de reposición" (`agente@mercadorai.com`).
No es una persona: es la identidad con la que **el agente automático**
firma las órdenes que propone — y con la que una futura caja/POS
registraría ventas. Puede leer el negocio y crear OCs, pero **nunca
aprobarlas** — por diseño, el robot no puede validarse a sí mismo.
No recibe alertas: las genera, no las consume.

---

## El agente automático

Corre cada hora por su cuenta (y además se despierta solo cuando una
venta deja un producto en cero). En cada corrida:

1. Lee los productos en riesgo.
2. Estima la demanda — con un modelo de lenguaje para los productos
   impredecibles (corre en local, los datos no salen del negocio) y
   con reglas estadísticas para los de venta pareja.
3. Elige proveedor por cada producto — pondera precio contra demora.
4. Calcula la cantidad a pedir.
5. Genera las OCs con su **análisis escrito** — lo que el aprobador lee
   antes de firmar.

Nada se compra solo: toda OC que supera el umbral espera firma humana.
El agente propone, documenta y acelera; la decisión sigue siendo de la
gente.

## Las pantallas en dos líneas

| Pantalla | Para qué sirve |
|---|---|
| **Dashboard / Órdenes** | La bandeja de OCs: pendientes, aprobadas, enviadas, recibidas — con buscador y filtros por estado |
| **Quiebres** | Los productos en riesgo ordenados por **plata que se pierde por día** — con acciones directas de venta y ajuste |
| **Métricas** | El scorecard: fill rate, margen en riesgo por día, margen perdido del período, inventario en plata, stock muerto y scorecard de proveedores |
| **Alertas** (solo BUYER) | La cola de trabajo del comprador |
| **Proveedores** (solo ADMIN) | ABM de proveedores y sus condiciones comerciales |
| **Usuarios** (solo ADMIN) | ABM de usuarios y roles |
| **Campanita** (GERENTE, APROBADOR, ADMIN) | Las alertas graves + órdenes urgentes, sin abrir nada |

## Glosario mínimo

- **OC / Orden de compra**: el pedido formal a un proveedor.
- **Quiebre**: stock en cero — góndola vacía con gente queriendo comprar.
- **Cobertura**: para cuántos días alcanza el stock al ritmo de venta actual.
- **Lead / demora del proveedor**: cuántos días tarda en entregar.
- **Fill rate**: qué porcentaje de los días el producto estuvo disponible.
- **Stock muerto**: mercadería que no rota hace más de 90 días.
- **Margen en riesgo**: la ganancia que se pierde por día mientras no
  haya stock — el número que ordena la tabla de quiebres.

---

*Las credenciales de prueba y los detalles técnicos están en el
`README.md`. El historial completo de decisiones de producto, en el
`SPEC.md`.*
