---
title: Configuración del SOC
description: Guía para configurar el Centro de Operaciones de Seguridad simulado
---

Esta guía te ayudará a configurar y personalizar el SOC (Security Operations Center) simulado de SOCIA.

## Arquitectura del SOC

### Componentes principales

El SOC de SOCIA está compuesto por:

- **SIEM (Security Information and Event Management)**
- **Sistema de gestión de incidentes**
- **Herramientas de análisis forense**
- **Consolas de monitorización**
- **Bases de datos de threat intelligence**

### Topología de red simulada

```
Internet
    ↓
Firewall → DMZ → Servidores Web
    ↓
Switch Core → VLAN Usuarios
    ↓        → VLAN Servidores
    ↓        → VLAN IoT
SOC Network
```

## Configuración inicial

### 1. Definir el perímetro de seguridad

```yaml
# config/network.yml
network:
  external_subnet: "203.0.113.0/24"
  dmz_subnet: "192.168.1.0/24"
  internal_subnet: "10.0.0.0/8"
  soc_subnet: "172.16.0.0/16"
  
security_zones:
  - name: "Internet"
    trust_level: 0
  - name: "DMZ"
    trust_level: 3
  - name: "Internal"
    trust_level: 7
  - name: "SOC"
    trust_level: 10
```

### 2. Configurar fuentes de logs

Define qué sistemas generarán eventos:

```yaml
# config/log_sources.yml
log_sources:
  firewalls:
    - name: "FW-Perimeter"
      type: "fortigate"
      ip: "192.168.1.1"
      events_per_hour: 500
      
  servers:
    - name: "WEB-01"
      type: "apache"
      ip: "192.168.1.10"
      events_per_hour: 1200
      
  endpoints:
    - name: "Workstations"
      type: "windows"
      count: 50
      events_per_hour: 100
```

### 3. Configurar herramientas SIEM

#### Reglas de correlación

```sql
-- Ejemplo de regla para detectar fuerza bruta
CREATE RULE brute_force_detection AS
SELECT 
    source_ip,
    COUNT(*) as failed_attempts,
    MIN(timestamp) as first_attempt,
    MAX(timestamp) as last_attempt
FROM security_events 
WHERE 
    event_type = 'authentication_failure'
    AND timestamp > NOW() - INTERVAL '5 minutes'
GROUP BY source_ip
HAVING COUNT(*) >= 5;
```

#### Dashboards de monitorización

```json
{
  "dashboard": "SOC_Overview",
  "panels": [
    {
      "title": "Eventos por Criticidad",
      "type": "pie_chart",
      "query": "SELECT severity, COUNT(*) FROM events GROUP BY severity"
    },
    {
      "title": "Top IPs Atacantes",
      "type": "table",
      "query": "SELECT source_ip, COUNT(*) as incidents FROM threats GROUP BY source_ip ORDER BY incidents DESC LIMIT 10"
    }
  ]
}
```

## Configuración de alertas

### Tipos de alertas

#### Críticas (Nivel 1)
- Compromiso confirmado de sistemas
- Exfiltración de datos
- Malware en sistemas críticos
- Acceso no autorizado a información sensible

#### Altas (Nivel 2)
- Intentos de intrusión
- Anomalías en el tráfico de red
- Fallos múltiples de autenticación
- Ejecución de código sospechoso

#### Medias (Nivel 3)
- Patrones de comportamiento anómalos
- Conexiones a dominios sospechosos
- Intentos de escalada de privilegios
- Configuraciones incorrectas de seguridad

#### Bajas (Nivel 4)
- Eventos informativos
- Actualizaciones de firmas
- Conexiones rutinarias
- Logs de auditoría

### Configuración de umbrales

```yaml
# config/alerting.yml
thresholds:
  failed_logins:
    warning: 3
    critical: 10
    timeframe: "5m"
    
  network_connections:
    suspicious_domains: 1
    data_transfer_mb: 100
    timeframe: "1h"
    
  malware_detection:
    any_detection: 1
    timeframe: "immediate"
```

## Playbooks y procedimientos

### Respuesta a incidentes

#### Nivel 1: Contención inmediata
1. Aislar sistemas afectados
2. Preservar evidencias
3. Notificar a stakeholders
4. Activar equipo de respuesta

#### Nivel 2: Investigación
1. Análisis forense inicial
2. Determinación del alcance
3. Identificación del vector de ataque
4. Evaluación del impacto

#### Nivel 3: Erradicación
1. Eliminación de la amenaza
2. Cierre de vulnerabilidades
3. Actualización de defensas
4. Validación de la eliminación

#### Nivel 4: Recuperación
1. Restauración de servicios
2. Monitorización intensiva
3. Validación de la normalidad
4. Documentación del incidente

### Plantillas de documentación

```markdown
# Reporte de Incidente SOC-2024-001

## Resumen ejecutivo
- **Fecha**: 2024-01-15
- **Criticidad**: Alta
- **Sistemas afectados**: WEB-01, DB-02
- **Impacto**: Acceso no autorizado a base de datos

## Timeline
- 09:15 - Alerta inicial: Tráfico anómalo
- 09:23 - Confirmación: Intento de SQLi
- 09:30 - Contención: Bloqueo de IP origen
- 10:45 - Análisis: Explotación de CVE-2024-XXXX

## Acciones tomadas
1. Aislamiento de sistemas afectados
2. Análisis de logs de acceso
3. Verificación de integridad de datos
4. Aplicación de parches de seguridad

## Recomendaciones
- Actualizar WAF rules
- Implementar rate limiting
- Revisión de código fuente
- Capacitación adicional al equipo
```

## Integración con herramientas externas

### APIs de threat intelligence

```python
# Integración con VirusTotal
import requests

def check_ip_reputation(ip_address):
    url = f"https://www.virustotal.com/vtapi/v2/ip-address/report"
    params = {
        'apikey': 'YOUR_API_KEY',
        'ip': ip_address
    }
    
    response = requests.get(url, params=params)
    return response.json()

# Integración con MISP
def query_misp_indicators():
    misp_url = "https://your-misp-instance.com"
    headers = {
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json'
    }
    
    response = requests.get(f"{misp_url}/events", headers=headers)
    return response.json()
```

### Automatización con SOAR

```yaml
# Workflow de respuesta automática
automation:
  triggers:
    - event_type: "malware_detected"
      severity: "high"
      
  actions:
    - isolate_endpoint:
        target: "{{ event.source_host }}"
        method: "network_quarantine"
        
    - create_ticket:
        system: "ServiceNow"
        priority: "P1"
        assignee: "security_team"
        
    - send_notification:
        channels: ["email", "slack"]
        recipients: ["soc_team", "ciso"]
```

## Métricas y KPIs

### Métricas operacionales

- **MTTD (Mean Time To Detection)**: Tiempo promedio para detectar amenazas
- **MTTR (Mean Time To Response)**: Tiempo promedio de respuesta
- **False Positive Rate**: Porcentaje de alertas incorrectas
- **Coverage**: Porcentaje de la red monitorizada

### Dashboard de métricas

```sql
-- Query para calcular MTTD
SELECT 
    AVG(TIMESTAMPDIFF(MINUTE, incident_start, detection_time)) as mttd_minutes
FROM incidents 
WHERE detection_time IS NOT NULL 
AND DATE(incident_start) = CURDATE();

-- Query para calcular tasa de falsos positivos
SELECT 
    (SUM(CASE WHEN status = 'false_positive' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as fp_rate
FROM alerts 
WHERE DATE(created_at) = CURDATE();
```

## Mantenimiento del SOC

### Tareas diarias
- Revisión de alertas pendientes
- Verificación de estado de sensores
- Actualización de reglas de correlación
- Análisis de métricas del día anterior

### Tareas semanales
- Revisión de playbooks
- Actualización de threat intelligence
- Análisis de tendencias
- Backup de configuraciones

### Tareas mensuales
- Evaluación de efectividad
- Optimización de reglas
- Capacitación del equipo
- Revisión de procedimientos

## Troubleshooting común

### Problema: Demasiadas alertas
**Solución**: Revisar y ajustar umbrales, implementar filtros adicionales

### Problema: Alertas perdidas
**Solución**: Verificar conectividad de sensores, revisar reglas de correlación

### Problema: Falsos positivos
**Solución**: Afinar reglas de detección, implementar whitelists

### Problema: Performance lenta
**Solución**: Optimizar queries, aumentar recursos de hardware

Esta configuración te proporcionará una base sólida para un SOC simulado efectivo en SOCIA.