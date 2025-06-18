---
title: Instalación
description: Guía de instalación de SOCIA
---

Esta guía te ayudará a instalar y configurar SOCIA en tu entorno local o de producción.

## Requisitos del sistema

### Requisitos mínimos

- **Sistema operativo**: Linux Ubuntu 20.04+ / CentOS 8+ / Windows 10+ / macOS 11+
- **RAM**: 4 GB
- **Almacenamiento**: 10 GB libres
- **CPU**: 2 núcleos a 2.0 GHz
- **Red**: Conexión a internet para descargas iniciales

### Requisitos recomendados

- **RAM**: 8 GB o más
- **Almacenamiento**: 20 GB libres (SSD recomendado)
- **CPU**: 4 núcleos a 2.5 GHz o superior
- **Red**: Conexión estable de banda ancha

## Software necesario

### Docker y Docker Compose

SOCIA utiliza contenedores Docker para facilitar el despliegue. Instala Docker según tu sistema operativo:

#### Linux (Ubuntu/Debian)
```bash
# Actualizar paquetes
sudo apt update

# Instalar Docker
sudo apt install docker.io docker-compose

# Agregar usuario al grupo docker
sudo usermod -aG docker $USER

# Reiniciar sesión o ejecutar
newgrp docker
```

#### macOS
```bash
# Instalar Docker Desktop
brew install --cask docker

# O descargar desde https://docker.com/products/docker-desktop
```

#### Windows
Descarga e instala Docker Desktop desde [docker.com](https://docker.com/products/docker-desktop)

### Git

```bash
# Linux (Ubuntu/Debian)
sudo apt install git

# macOS
brew install git

# Windows
# Descargar desde https://git-scm.com/download/win
```

## Instalación paso a paso

### 1. Clonar el repositorio

```bash
git clone https://github.com/IES-Rafael-Alberti/socia.git
cd socia
```

### 2. Configurar variables de entorno

```bash
# Copiar archivo de configuración de ejemplo
cp .env.example .env

# Editar configuración
nano .env
```

Configura las siguientes variables principales:

```env
# Configuración de la base de datos
DB_HOST=localhost
DB_PORT=5432
DB_NAME=socia
DB_USER=socia_user
DB_PASSWORD=tu_password_seguro

# Configuración de la IA
OPENAI_API_KEY=tu_api_key_aqui
AI_MODEL=gpt-4

# Configuración del servidor
SERVER_PORT=3000
SERVER_HOST=0.0.0.0

# Configuración de autenticación
JWT_SECRET=tu_jwt_secret_muy_seguro
SESSION_SECRET=tu_session_secret_muy_seguro

# Configuración de logs
LOG_LEVEL=info
LOG_DIR=./logs
```

### 3. Ejecutar con Docker Compose

```bash
# Construir e iniciar todos los servicios
docker-compose up -d

# Ver logs en tiempo real
docker-compose logs -f
```

### 4. Verificar la instalación

Accede a `http://localhost:3000` en tu navegador. Deberías ver la página de bienvenida de SOCIA.

## Instalación manual (desarrollo)

Si prefieres una instalación manual para desarrollo:

### 1. Instalar Node.js y Python

```bash
# Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Python 3.9+
sudo apt install python3 python3-pip
```

### 2. Instalar PostgreSQL

```bash
# Linux
sudo apt install postgresql postgresql-contrib

# Crear base de datos
sudo -u postgres createdb socia
sudo -u postgres createuser socia_user
sudo -u postgres psql -c "ALTER USER socia_user PASSWORD 'tu_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE socia TO socia_user;"
```

### 3. Instalar dependencias

```bash
# Frontend (React)
cd frontend
npm install

# Backend (Node.js)
cd ../backend
npm install

# Servicios de IA (Python)
cd ../ai-services
pip install -r requirements.txt
```

### 4. Ejecutar migraciones

```bash
cd backend
npm run migrate
```

### 5. Iniciar servicios

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm start

# Terminal 3: Servicios de IA
cd ai-services
python app.py
```

## Configuración inicial

### 1. Crear usuario administrador

```bash
docker-compose exec backend npm run create-admin
```

### 2. Cargar datos de ejemplo

```bash
docker-compose exec backend npm run seed
```

### 3. Configurar primera organización

1. Accede a `http://localhost:3000/admin`
2. Inicia sesión con las credenciales de administrador
3. Ve a "Organizaciones" > "Nueva organización"
4. Completa los datos de tu centro educativo

## Resolución de problemas

### Error de permisos de Docker

```bash
sudo chmod 666 /var/run/docker.sock
# O reiniciar sesión después de agregar usuario al grupo docker
```

### Puerto 3000 ocupado

```bash
# Encontrar proceso usando el puerto
sudo lsof -i :3000

# Cambiar puerto en .env
SERVER_PORT=3001
```

### Error de conexión a base de datos

1. Verificar que PostgreSQL esté ejecutándose:
```bash
docker-compose ps
```

2. Revisar logs de la base de datos:
```bash
docker-compose logs postgres
```

### Problemas con la API de IA

1. Verificar que la API key sea válida
2. Comprobar límites de la API
3. Revisar logs del servicio de IA:
```bash
docker-compose logs ai-service
```

## Actualizaciones

Para actualizar SOCIA a la última versión:

```bash
# Obtener últimos cambios
git pull origin main

# Actualizar contenedores
docker-compose pull
docker-compose up -d

# Ejecutar migraciones si es necesario
docker-compose exec backend npm run migrate
```

## Copias de seguridad

### Base de datos

```bash
# Crear backup
docker-compose exec postgres pg_dump -U socia_user socia > backup.sql

# Restaurar backup
docker-compose exec -T postgres psql -U socia_user socia < backup.sql
```

### Configuración y datos

```bash
# Backup completo
tar -czf socia-backup-$(date +%Y%m%d).tar.gz \
  .env \
  docker-compose.yml \
  data/ \
  logs/
```