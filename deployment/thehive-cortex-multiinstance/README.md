# SOCIA TheHive

Este repositorio contiene el despliegue SOCIA de TheHive, Cortex, Cassandra,
Elasticsearch y el flujo activo de alertas desde Graylog/Kafka hacia TheHive.

## Resumen rápido

Stack base:

```bash
cd /opt/socia-thehive
sudo docker compose up -d
sudo docker compose ps
```

Consumidor activo:

```bash
sudo systemctl status graylog-alert-consumer --no-pager
```

Verificación funcional:

```bash
cd /opt/socia-thehive
sudo ./verify.sh
```

Crear instancias de alumnos con backend compartido:

```bash
cd /home/debian/socia-thehive/multiinstance-shared-backend
sudo ./create-many.sh 10
```

La vía legacy `thehive-consumer` para `ioc-events/ioc-events-alerts` está
retirada de la instalación activa y archivada en:

```text
/home/debian/old-scripts/thehive-consumer
```

## Orden recomendado de despliegue

Si se parte desde cero:

1. Ejecuta `sudo ./install.sh` desde `/home/debian/socia-thehive`.
2. Entra en el TheHive principal en `http://IP_DEL_SERVIDOR:9000` y completa
   el asistente inicial.
3. Vuelve a ejecutar `sudo ./install.sh` para que el consumidor principal quede
   con su `THEHIVE_API_KEY`.
4. Verifica el stack base con `sudo ./verify.sh`.
5. Solo después crea instancias adicionales en
   `multiinstance-shared-backend/`.

Los pasos detallados y qué secretos faltan en cada fase están en:

- [docs/operations.md](docs/operations.md)
- [docs/multiinstance-shared-backend.md](docs/multiinstance-shared-backend.md)

## Arquitectura

La implementación activa está dividida en 3 bloques:

1. Stack base compartido.
   `docker-compose.yml` levanta `socia-cassandra`, `socia-elasticsearch`,
   `socia-thehive` y `socia-cortex`.
2. Multiinstancia ligera.
   `multiinstance-shared-backend/` crea TheHive por alumno reutilizando el
   Cassandra y Elasticsearch compartidos.
3. Flujo activo de alertas.
   `graylog-alert-consumer/graylog-alert-consumer.py` consume
   `graylog-alerts` y crea alertas en TheHive.

Más detalle en [docs/architecture.md](docs/architecture.md).

## Documentación

- [docs/architecture.md](docs/architecture.md): visión general del stack,
  flujo Graylog/Kafka -> TheHive y piezas principales.
- [docs/operations.md](docs/operations.md): instalación, verificación,
  diagnóstico, actualización, secretos y orden de bootstrap.
- [docs/multiinstance-shared-backend.md](docs/multiinstance-shared-backend.md):
  creación, borrado, arranque/parada, prerequisitos y credenciales de las
  instancias de alumnos.
- [docs/legacy.md](docs/legacy.md): piezas retiradas, archivos archivados y
  notas históricas.

## Rutas importantes

| Ruta | Uso |
| --- | --- |
| `/home/debian/socia-thehive` | Repositorio fuente. |
| `/opt/socia-thehive` | Instalación real del stack base. |
| `/opt/socia-thehive/.env` | Secretos del stack base Docker. |
| `/opt/socia-thehive/graylog-alert-consumer/.env` | Configuración del consumidor activo `graylog-alerts`. |
| `/opt/socia-students/<instancia>` | Instancias de alumnos con backend compartido. |
| `/etc/systemd/system/graylog-alert-consumer.service` | Servicio systemd del consumidor principal. |
| `/etc/systemd/system/graylog-alert-consumer-<instancia>.service` | Servicio systemd por instancia. |

No subas `.env` reales al repositorio. Contienen API keys y secretos.
