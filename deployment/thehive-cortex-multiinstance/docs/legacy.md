# Legacy

## Vía retirada

La vía `thehive-consumer` para `ioc-events/ioc-events-alerts` ya no forma parte
de la instalación activa.

Se retiró porque la vía operativa actual es:

```text
graylog-alerts -> graylog-alert-consumer -> TheHive
```

## Archivo histórico

Los ficheros retirados quedaron archivados en:

```text
/home/debian/old-scripts/thehive-consumer
```

Contenido preservado:

- `source/thehive-consumer.py`
- `source/consumer.env.example`
- `source/thehive-consumer.service`
- `runtime/thehive-consumer.py`
- `runtime/consumer.env`
- `runtime/thehive-consumer.service`

## Multiinstance legacy

La modalidad:

```text
/home/debian/socia-thehive/multiinstance
```

debe considerarse histórica en esta instalación. Dependía de la vía
`thehive-consumer` y ya no es el modo recomendado.

Para operación real usa:

```text
/home/debian/socia-thehive/multiinstance-shared-backend
```

## Notas operativas

Si encuentras referencias a `thehive-consumer` fuera del archivo histórico,
trátalas como:

- documentación antigua
- scripts no operativos
- restos pendientes de limpieza

Antes de reactivar cualquier pieza legacy, revisa:

1. si sigue existiendo su unidad systemd
2. si el topic Kafka sigue publicando ese formato
3. si no duplicará alertas con la vía `graylog-alert-consumer`
