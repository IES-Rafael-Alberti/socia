# Multiinstancia con Backend Compartido

## Ruta

La modalidad operativa para aulas está en:

```text
/home/debian/socia-thehive/multiinstance-shared-backend
```

Reutiliza:

- `socia-cassandra`
- `socia-elasticsearch`
- red Docker `socia-thehive`
- `socia-cortex`

Cada alumno recibe solo:

- `socia-<instancia>-thehive`
- `socia-<instancia>-thehive-files`
- `socia-<instancia>-thehive-logs`
- `graylog-alert-consumer-<instancia>.service`

## Requisitos

El stack base debe estar levantado:

```bash
cd /opt/socia-thehive
sudo docker compose up -d
sudo docker compose ps
```

Además, antes de crear instancias:

- el TheHive principal de `9000` debe estar inicializado y accesible
- debes poder entrar con el admin del TheHive principal
- si quieres consumidores por instancia, Kafka debe ser accesible
- si quieres copiar integraciones, la configuración principal de MISP/Cortex
  debe estar ya funcionando

Credenciales por defecto que espera el script:

```text
ADMIN_USER=admin@thehive.local
ADMIN_PASSWORD=secret
```

Si no coinciden con tu instalación, pásalas al invocar el script. También puedes
usar `ADMIN_API_KEY`.

## Crear instancias

Crear una:

```bash
cd /home/debian/socia-thehive/multiinstance-shared-backend
sudo ./create-instance.sh contenedor1 9101
```

Si el admin del principal no usa la password por defecto:

```bash
sudo ADMIN_PASSWORD='tu-password-real' ./create-instance.sh contenedor1 9101
```

Si prefieres usar API key del admin del principal:

```bash
sudo ADMIN_API_KEY='...' ./create-instance.sh contenedor1 9101
```

Crear varias:

```bash
sudo ./create-many.sh 10
```

Con otro prefijo y otro rango de puertos:

```bash
sudo PREFIX=alumno START_INDEX=1 START_PORT=9201 ./create-many.sh 10
```

Sin consumidor por instancia:

```bash
sudo NO_CONSUMER=1 ./create-many.sh 10
```

Orden recomendado en laboratorio:

1. Levanta y verifica primero el TheHive principal.
2. Deja funcionando su consumidor principal.
3. Crea una instancia de prueba con `create-instance.sh`.
4. Si esa funciona, crea el resto con `create-many.sh`.

## Qué crea cada instancia

Ejemplo para `contenedor1`:

| Recurso | Nombre |
| --- | --- |
| Contenedor TheHive | `socia-contenedor1-thehive` |
| Puerto | `9101` |
| Cassandra keyspace | `thehive_contenedor1` |
| Elasticsearch index | `thehive-contenedor1` |
| Cookie de sesión | `THEHIVE_SESSION_contenedor1` |
| Servicio consumidor | `graylog-alert-consumer-contenedor1.service` |

Directorio en disco:

```text
/opt/socia-students/contenedor1
```

Usuarios creados:

- `analista1@thehive.local` / `analista1`
- `analista2@thehive.local` / `analista2`

Organización:

```text
SOCIA
```

## Variables útiles

```bash
sudo \
  BASE_DIR=/opt/socia-students \
  KAFKA_BOOTSTRAP_SERVERS=172.17.33.153:9092 \
  ADMIN_USER=admin@thehive.local \
  ADMIN_PASSWORD=secret \
  CORTEX_ENABLED=true \
  MISP_API_KEY='...' \
  ./create-instance.sh contenedor1 9101
```

También admite, cuando haga falta:

- `ADMIN_API_KEY`
- `CORTEX_API_KEY`
- `CORTEX_ANALYZERS`
- `MISP_API_KEY`

## Cortex y MISP por instancia

El script intenta:

- copiar la configuración Cortex del principal
- copiar la configuración MISP del principal

o, si se le pasa la configuración directamente:

- usar `CORTEX_API_KEY`
- usar `MISP_API_KEY`

## Consumidor Kafka por instancia

Cada instancia usa:

```text
KAFKA_TOPIC=graylog-alerts
KAFKA_GROUP_ID=thehive-graylog-<instancia>
THEHIVE_URL=http://127.0.0.1:<puerto_instancia>
```

Eso hace que todas las instancias reciban las mismas alertas del topic
`graylog-alerts`.

Si se crea consumidor por instancia, su configuración queda dentro de la propia
instancia en `/opt/socia-students/<instancia>/.env`.

## Programación

Crear instancias en una fecha concreta:

```bash
sudo ./schedule-create-many.sh 10 "2026-05-20 13:00"
```

Borrar instancias en una fecha concreta:

```bash
sudo ./schedule-delete-many.sh 10 "2026-05-20 18:00"
```

## Arranque y parada masiva

El script `thehive-many.sh` permite operar solo los contenedores TheHive de las
instancias ya creadas y, si existe, su `graylog-alert-consumer` asociado.

Estado de todas:

```bash
sudo ./thehive-many.sh status --all
```

Parar 10 consecutivas desde `START_INDEX=1`:

```bash
sudo ./thehive-many.sh stop 10
```

Reiniciar todas las del prefijo `alumno`:

```bash
sudo PREFIX=alumno ./thehive-many.sh restart --all
```

Este script no levanta ni para `socia-cassandra`, `socia-elasticsearch` ni
`socia-cortex`; solo actúa sobre cada `socia-<instancia>-thehive`.

## Borrado

Borrar una:

```bash
sudo ./delete-instance.sh contenedor1
```

Borrar muchas:

```bash
sudo ./delete-many.sh 10
sudo ./delete-many.sh --all
```

Conservar `keyspace` e índices:

```bash
sudo ./delete-instance.sh contenedor1 --keep-shared-data
sudo KEEP_SHARED_DATA=1 ./delete-many.sh 10
```

## Limpieza y comprobaciones

```bash
sudo docker ps -a
sudo docker volume ls
sudo docker network ls
sudo docker system df
```

Puertos por defecto:

- principal `9000`
- Cortex `9001`
- alumnos `9101`, `9102`, ...

Comprobar si un puerto está ocupado:

```bash
sudo ss -ltnp
sudo ss -ltn "( sport = :9101 )"
```
