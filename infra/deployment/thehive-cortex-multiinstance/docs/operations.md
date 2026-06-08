# Operaciones

## Arranque del stack base

```bash
cd /opt/socia-thehive
sudo docker compose up -d
sudo docker compose ps
```

Logs útiles:

```bash
sudo docker compose logs --tail=150 thehive
sudo docker compose logs --tail=150 cortex
sudo docker compose logs --tail=150 cassandra
sudo docker compose logs --tail=150 elasticsearch
```

## Servicio activo de alertas

```bash
sudo systemctl status graylog-alert-consumer --no-pager
sudo journalctl -u graylog-alert-consumer --since "1 hour ago" --no-pager
sudo systemctl restart graylog-alert-consumer
```

## Verificación funcional

El script operativo es:

```bash
cd /opt/socia-thehive
sudo ./verify.sh
```

Comprueba:

1. Contenedores base Docker.
2. HTTP 200 en `THEHIVE_URL/api/status`.
3. Servicio `graylog-alert-consumer`.
4. Envío de mensaje de prueba a Kafka.
5. Creación de alerta de prueba en TheHive.

Para la prueba de Kafka debe existir algún productor disponible:

- `kcat`
- `kafka-console-producer`
- un contenedor Kafka accesible

## Instalación base desde cero

```bash
cd /home/debian/socia-thehive
sudo ./install.sh
```

Si TheHive aún no está inicializado:

1. Entra en `http://IP_DEL_SERVIDOR:9000`.
2. Completa la configuración inicial.
3. Vuelve a ejecutar `sudo ./install.sh`.

Comprobación mínima tras esa segunda ejecución:

```bash
sudo test -f /opt/socia-thehive/graylog-alert-consumer/.env && echo ok
sudo systemctl status graylog-alert-consumer --no-pager
```

Orden práctico desde cero:

1. Levanta primero el TheHive principal y sus backends con `install.sh`.
2. Completa el asistente web del principal.
3. Deja funcionando el consumidor principal con su `THEHIVE_API_KEY`.
4. Solo entonces crea TheHives adicionales con backend compartido.

## Secretos y API keys

Rutas principales:

```text
/opt/socia-thehive/.env
/opt/socia-thehive/graylog-alert-consumer/.env
```

Qué guarda cada una:

- `/opt/socia-thehive/.env`: secretos internos del stack base como
  `THEHIVE_SECRET`, `THEHIVE_PUBLIC_URL`, `CORTEX_SECRET` y rutas de Cortex.
- `/opt/socia-thehive/graylog-alert-consumer/.env`: configuración del
  consumidor principal, incluida `THEHIVE_API_KEY`.

Qué falta poner o revisar en un despliegue nuevo:

- `THEHIVE_ADMIN_EMAIL` y `THEHIVE_ADMIN_PASSWORD` si no usas los valores por
  defecto esperados por `install.sh`.
- `KAFKA_BOOTSTRAP_SERVERS` si el broker no es el default del script.
- `MISP_API_KEY` si quieres dejar MISP integrado durante el bootstrap.
- `CORTEX_API_KEY` solo si no quieres que el script intente bootstrapear Cortex.

Si `install.sh` no puede obtener la `THEHIVE_API_KEY` automáticamente:

1. Entra en el TheHive principal.
2. Crea o renueva una API key del usuario admin.
3. Ponla en `/opt/socia-thehive/graylog-alert-consumer/.env`.
4. Reinicia `graylog-alert-consumer`.

## Recuperación

Estado general:

```bash
sudo systemctl status docker --no-pager
cd /opt/socia-thehive
sudo docker compose ps
sudo systemctl status graylog-alert-consumer --no-pager
```

Si Docker está parado:

```bash
sudo systemctl restart docker
cd /opt/socia-thehive
sudo docker compose up -d
```

Si TheHive no responde:

```bash
cd /opt/socia-thehive
sudo docker compose logs --tail=200 thehive
sudo docker compose logs --tail=200 cassandra
sudo docker compose logs --tail=200 elasticsearch
```

Si Graylog alerts no llegan:

```bash
sudo systemctl status graylog-alert-consumer --no-pager
sudo journalctl -u graylog-alert-consumer --since "1 hour ago" --no-pager
```

Revisa especialmente:

- `KAFKA_TOPIC=graylog-alerts`
- `KAFKA_GROUP_ID`
- `THEHIVE_API_KEY`
- `THEHIVE_ORG`

## Kafka y consumidor activo

Valores típicos:

```text
KAFKA_BOOTSTRAP_SERVERS=172.17.33.153:9092
GRAYLOG_ALERT_KAFKA_TOPIC=graylog-alerts
KAFKA_AUTO_OFFSET_RESET=latest
KAFKA_MAX_POLL_RECORDS=25
KAFKA_GROUP_ID=thehive-docker-<ip-del-host-con-guiones>
```

## API keys y secretos

Rutas principales:

```text
/opt/socia-thehive/.env
/opt/socia-thehive/graylog-alert-consumer/.env
```

Si cambias `THEHIVE_SECRET` o `CORTEX_SECRET` en un sistema ya usado, puedes
romper sesiones, tokens o datos cifrados.

Si la `THEHIVE_API_KEY` deja de funcionar, el consumidor seguirá vivo pero
fallará al crear alertas. Tras actualizarla:

```bash
sudo systemctl restart graylog-alert-consumer
```

## Actualizar la instalación real

El instalador copia el repo a `/opt/socia-thehive`, pero editar
`/home/debian/socia-thehive` no actualiza automáticamente `/opt/socia-thehive`.

Para aplicar cambios de forma completa:

```bash
cd /home/debian/socia-thehive
sudo ./install.sh
```

Para cambios puntuales:

```bash
sudo cp /home/debian/socia-thehive/docker-compose.yml /opt/socia-thehive/docker-compose.yml
cd /opt/socia-thehive
sudo docker compose up -d
```

## Comandos de diagnóstico frecuentes

Docker:

```bash
sudo docker ps -a
sudo docker compose -f /opt/socia-thehive/docker-compose.yml ps
sudo docker compose -f /opt/socia-thehive/docker-compose.yml logs --tail=100
sudo docker system df
```

Systemd:

```bash
sudo systemctl status docker --no-pager
sudo systemctl status graylog-alert-consumer --no-pager
sudo systemctl list-units 'graylog-alert-consumer-*'
```

Logs:

```bash
sudo journalctl -u graylog-alert-consumer --since "1 hour ago" --no-pager
sudo journalctl -u 'graylog-alert-consumer-contenedor1' --since "1 hour ago" --no-pager
```

## Acciones peligrosas

Evita estos comandos salvo reconstrucción total:

```bash
cd /opt/socia-thehive
sudo docker compose down -v
sudo docker system prune -a --volumes
sudo docker volume rm socia-thehive_cassandra-data
sudo docker volume rm socia-thehive_elasticsearch-data
```

También evita borrar a mano:

```text
/opt/socia-thehive/.env
/opt/socia-thehive/graylog-alert-consumer/.env
/opt/socia-students
```
