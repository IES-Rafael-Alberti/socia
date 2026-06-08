# Arquitectura

## Stack base compartido

El stack principal está en `docker-compose.yml` y levanta:

- `socia-cassandra`
- `socia-elasticsearch`
- `socia-thehive`
- `socia-cortex`

La idea es:

- Cassandra y Elasticsearch se comparten entre el TheHive principal y las
  instancias de alumnos.
- El TheHive principal en `:9000` también sirve como origen de configuración
  para MISP y Cortex.
- Cortex principal está en `:9001`.

El orden lógico de arranque es:

1. `socia-cassandra`
2. `socia-elasticsearch`
3. `socia-thehive`
4. `socia-cortex`

Los 4 contenedores usan `restart: unless-stopped`.

## Multiinstancia ligera

El modo operativo para aulas está en `multiinstance-shared-backend/`.

Cada alumno no recibe una pila completa. Solo se crea:

- un contenedor TheHive nuevo
- su volumen de ficheros
- su volumen de logs
- su servicio `graylog-alert-consumer-<instancia>.service`

El aislamiento real se hace por:

- `keyspace` de Cassandra
- `index-name` de Elasticsearch
- volúmenes propios de ficheros y logs
- cookie de sesión propia

La plantilla clave es:

- `multiinstance-shared-backend/templates/application.conf.tpl`

Ahí cada instancia apunta al backend compartido pero con su `keyspace` e índice
propios.

## Flujo Graylog/Kafka -> TheHive

La vía activa de alertas es:

1. Graylog genera o expone el evento.
2. Un relay externo lo empuja a Kafka.
3. `graylog-alert-consumer.py` consume `graylog-alerts`.
4. El consumidor normaliza el payload y crea la alerta en TheHive vía
   `POST /api/v1/alert`.

El consumidor activo está en:

- `graylog-alert-consumer/graylog-alert-consumer.py`

El relay externo que aparece en esta máquina está en:

- `/home/debian/graylog-kafka-relay.py`
- `/home/debian/graylog2kafka/systemd/graylog2kafka.service`

Parece ser la pieza que recoge notificaciones de Graylog, recupera el mensaje
original y lo reenvía a Kafka antes de que los consumidores publiquen en
TheHive.

## Consumidor principal activo

El servicio activo del host es:

- `graylog-alert-consumer.service`

Su configuración vive en:

- `/opt/socia-thehive/graylog-alert-consumer/.env`

Valores típicos:

```text
KAFKA_TOPIC=graylog-alerts
THEHIVE_URL=http://127.0.0.1:9000
```

## Consumidores por instancia

Cada instancia de alumno recibe su propio `group_id`, por ejemplo:

```text
thehive-graylog-contenedor1
thehive-graylog-contenedor2
```

Eso hace que todas las instancias consuman el mismo topic `graylog-alerts`,
pero cada TheHive reciba su copia independiente de las alertas.

La plantilla de entorno está en:

- `multiinstance-shared-backend/templates/graylog-alert-consumer.env.tpl`

Valores clave:

```text
KAFKA_TOPIC=graylog-alerts
KAFKA_GROUP_ID=thehive-graylog-<instancia>
THEHIVE_URL=http://127.0.0.1:<puerto_instancia>
```

## Red y persistencia

La red Docker principal es:

```text
socia-thehive
```

Volúmenes persistentes del stack base:

- `socia-thehive_cassandra-data`
- `socia-thehive_elasticsearch-data`
- `socia-thehive_thehive-files`
- `socia-thehive_thehive-logs`
- `socia-thehive_cortex-logs`

No borres la red ni los volúmenes del stack base mientras haya servicios SOCIA
en uso.
