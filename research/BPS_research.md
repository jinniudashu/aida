# AIDA 项目深度研究报告

> 本文档为 AIDA 项目及其实现 erpsys 的深度研究报告，作为后续重构工作的基础参考。

---

## 一、项目定位与核心理念

### 1.1 项目愿景

AIDA 基于"**状态机世界模型**"定义"业务语义空间"的元模型，其核心理念是：

- **世界是个状态机**：任何组织活动都可视为将标的物状态从 A 迁移至 B 的计算过程
- **业务流程即代码 (Business Process as Code)**：业务蓝图本身可被运行时引擎解释执行
- **业务虚拟机 (Business Virtual Machine)**：定义了一台虚拟机规范，遵循 BPS 规范描述的业务蓝图即是这台虚拟机的"程序"

### 1.2 核心规范文档

| 文档 | 用途 |
|------|------|
| BPS (Business Process Specification) v0.9 | 核心元模型规范，定义 Entity/Service/Rule/Role/Instruction/Process 六大组件 |
| SBMP (Standard Business Modeling Process) v0.2 | 推荐的业务建模操作指南，指导从业务调研到模型建立的完整过程 |

### 1.3 六大核心元模型组件 (BPS 定义)

```
Entity (实体)    ─── 业务对象及其组合关系，静态世界基石
Service (服务)   ─── 业务任务类型定义，可原子可复合
Rule (规则)      ─── Event → Instruction 映射，驱动流程流转
Role (角色)      ─── 计算节点类型抽象，"谁来做"
Instruction (指令) ── 运行时引擎原子操作接口
Process (进程)   ─── Service 的运行时实例，状态迁移载体
```

---

## 二、技术栈

| 层面 | 技术 | 版本 |
|------|------|------|
| Web 框架 | Django | 4.2.7 |
| API 框架 | Django REST Framework | 3.14.0 |
| ASGI 服务器 | Daphne | 4.1.2 |
| 实时通信 | Django Channels | 4.1.0 |
| 数据库 (开发) | SQLite | - |
| 数据库 (生产) | PostgreSQL | - |
| 缓存/消息代理 | Redis | 3 个 DB (Channel/Broker/Result) |
| 任务队列 | Celery + Django Celery Beat | 5.3.6 / 2.6.0 |
| 认证 | SimpleJWT | 5.3.1 |
| 数据分析 | pandas / openpyxl | 2.2.2 / 3.1.2 |
| 中文支持 | pypinyin | 0.51.0 |
| MCP 支持 | fastmcp / mcp | 2.3.4 / 1.9.0 |
| 容器化 | Docker + docker-compose | - |

---

## 三、架构分析

### 3.1 三层架构总览

```
┌─────────────────────────────────────────────────────┐
│  DESIGN 层 (design/)  ── 元建模系统 / 设计器          │
│  定义 DataItem, Service, ServiceRule, Event,         │
│  Instruction, Form, Api 等元模型                      │
├─────────────────────────────────────────────────────┤
│  KERNEL 层 (kernel/)  ── 运行时引擎 / 业务虚拟机       │
│  Process 管理, 上下文堆栈, 规则评估, 系统调用,          │
│  WebSocket 实时推送, 任务调度                          │
├─────────────────────────────────────────────────────┤
│  APPLICATION 层 (applications/) ── 领域实例化           │
│  具体业务模型 (医美诊所 Demo), 由元定义生成             │
└─────────────────────────────────────────────────────┘
```

### 3.2 目录结构

```
aida/
├── README.md
├── BPS 规范文档.md
├── SBMP 建模指南.md
└── erpsys/
    ├── manage.py                  # Django 入口
    ├── dev_initial.py             # 开发环境初始化脚本
    ├── requirements.txt           # Python 依赖
    ├── Dockerfile / docker-compose.yml
    ├── erpsys/                    # Django 项目配置
    │   ├── settings.py            # 配置 (DB/Redis/JWT/CORS/Celery)
    │   ├── urls.py                # URL 路由
    │   ├── asgi.py                # ASGI 应用 (HTTP + WebSocket)
    │   └── celery.py              # Celery 配置
    ├── design/                    # 设计层
    │   ├── models.py              # 元模型定义 (~510 行)
    │   ├── types.py               # 枚举类型定义
    │   └── admin.py               # Admin 配置
    ├── kernel/                    # 内核层
    │   ├── models.py              # 运行时模型 (~345 行)
    │   ├── types.py               # 进程状态枚举 + Context Schema
    │   ├── sys_lib.py             # 核心业务逻辑 (~980 行)
    │   ├── views.py               # JWT 视图
    │   ├── consumers.py           # WebSocket 消费者
    │   ├── routing.py             # WebSocket 路由
    │   ├── tasks.py               # Celery 异步任务
    │   ├── signals.py             # Django 信号
    │   └── app_types.py           # 应用类型注册
    ├── applications/              # 应用层
    │   ├── models.py              # 领域模型 (~1075 行)
    │   └── admin.py               # Admin 配置
    ├── templates/                 # HTML 模板
    └── static/                    # 静态资源
```

---

## 四、Design 层详细分析

### 4.1 核心模型

#### ERPSysBase (抽象基类)

`design/models.py:15` — 所有设计层模型的基类

| 字段 | 说明 |
|------|------|
| label | 中文名称 |
| name | 英文名称 (自动由 label 拼音生成) |
| pym | 拼音码 (首字母) |
| erpsys_id | UUID 全局唯一标识 |

`save()` 方法自动完成中文 → 拼音转换和 UUID 生成。

#### DataItem (数据项 / 实体定义)

`design/models.py:38` — BPS 中 Entity 的实现

| 字段 | 说明 |
|------|------|
| consists | 多对多自关联 (通过 DataItemConsists)，定义组合关系 |
| field_type | 16 种字段类型 (CharField/IntegerField/ComputedField/Process 等) |
| business_type | 自引用外键，实现 is-a 类型继承 |
| affiliated_to | 自引用外键，实现 part-of 隶属关系 |
| implement_type | 实现类型 (Field/Model/KernelModel/Log/View/MenuItem/Program) |
| dependency_order | 依赖顺序 (数字越小越优先) |
| computed_logic | 计算字段逻辑 |
| init_content | JSON 初始内容 |

关键方法：
- `get_ancestry_and_consists()` — 遍历继承树，收集祖先链及其所有 consists 成员

#### Service (服务定义)

`design/models.py:178` — BPS 中 Service 的实现

| 字段 | 说明 |
|------|------|
| serve_content_type | ContentType 外键，服务对象类型 |
| consists | 多对多自关联 (通过 ServiceConsists)，服务组合 |
| subject | 指向 DataItem，作业记录类型 |
| form | 关联 Form 表单 |
| primitive | 是否原子服务 |
| manual_start | 是否手动启动 |
| program | JSONField，服务程序定义 |
| service_type | MANUAL / AGENT / SYSTEM |
| price | 价格 |
| route_to | 传递至特定 Operator |
| material/equipment/device/capital/knowledge_requirements | 五类资源需求 (各通过独立中间表) |

#### ServiceRule (服务规则)

`design/models.py:359` — BPS 中 Rule 的实现

| 字段 | 说明 |
|------|------|
| target_service | 隶属服务 (规则所在的服务程序) |
| order | 排序号 |
| service | 主体服务 (当前服务) |
| event | 触发事件 |
| system_instruction | 系统指令 |
| operand_service | 操作服务 (后续要启动的服务) |
| entity_content_type/object_id | 泛型外键到任意实体 |
| parameter_values | JSON 参数 |

#### Event (事件)

`design/models.py:339`

| 字段 | 说明 |
|------|------|
| description | 描述表达式 (自然语言) |
| expression | 布尔表达式 (如 `process_state=='NEW'`) |
| is_timer | 是否定时事件 |
| parameters | JSON 参数 |

#### Instruction (指令)

`design/models.py:350`

| 字段 | 说明 |
|------|------|
| sys_call | 系统调用名称 (如 `start_service`, `call_sub_service`) |
| parameters | JSON 参数 |

### 4.2 资源体系

Design 层定义了五类资源模型及对应的需求中间表：

| 资源类型 | 模型 | 需求中间表 | 资源性质 |
|----------|------|------------|----------|
| 物料 | Material | MaterialRequirements | 消耗型 |
| 设备 | Equipment | EquipmentRequirements | 分时复用 |
| 器材 | Device | DeviceRequirements | 回收型 |
| 资金 | Capital | CapitalRequirements | 消耗型 |
| 知识 | Knowledge | KnowledgeRequirements | 共享型 |

### 4.3 其他设计层模型

- **Form / FormFields** — 动态表单定义
- **Api / ApiFields** — 外部 API 集成
- **MenuItem** — 导航菜单结构
- **Project / SourceCode** — 项目与源码管理
- **WorkOrder / WorkOrderFields** — 工单定义
- **Organization** — 组织结构
- **Role / Operator** — 角色与人员

---

## 五、Kernel 层详细分析

### 5.1 运行时模型

#### Process (进程)

`kernel/models.py:203` — BPS 中 Process 的实现，核心运行时实体

| 字段 | 说明 |
|------|------|
| pid | 自增进程 ID (PidField 自定义字段) |
| parent | 父进程自引用 |
| previous | 前一个进程自引用 |
| entity_content_type/object_id | 泛型外键绑定业务实体 |
| service | 关联 Service |
| state | 进程状态 (7 种) |
| priority | 优先级 |
| scheduled_time / time_window | 调度时间和时间窗 |
| operator / creator | 操作员 / 创建者 |
| work_order | 工单 |
| form_content_type/object_id | 泛型外键绑定表单实例 |
| form_url | 表单 URL |
| program_entrypoint | 服务程序入口点 (erpsys_id) |

**进程状态机：**

```
NEW ──→ READY ──→ RUNNING ──→ TERMINATED
  │        ↑          │
  │        │          ↓
  │        └──── WAITING
  │                   │
  └──→ ERROR    SUSPENDED
```

#### ProcessContextSnapshot (上下文快照)

`kernel/models.py:289` — 进程上下文的版本化持久存储

| 字段 | 说明 |
|------|------|
| process | 关联 Process |
| version | 版本号 (自增) |
| context_data | JSON 上下文数据 |
| context_hash | SHA-256 哈希 (变化检测) |

### 5.2 核心运行时逻辑 (sys_lib.py)

#### ContextFrame — 上下文帧

`kernel/sys_lib.py:25` — 表示单个 Process 的执行上下文

```python
ContextFrame:
    process         # 关联的 Process 实例
    parent_frame    # 父帧 (嵌套调用时)
    status          # 'ACTIVE'
    local_vars      # 局部变量 (含进程信息)
    return_value    # 返回值
    inherited_context  # 从父帧继承的上下文
    events_triggered_log  # 触发的事件日志
    error_info      # 错误信息
```

#### ContextStack — 上下文堆栈

`kernel/sys_lib.py:76` — 管理多个 ContextFrame，模拟函数调用栈

- `push(process)` → 创建新帧入栈
- `pop()` → 弹出当前帧
- `current_frame()` → 获取栈顶帧
- 支持 JSON 序列化/反序列化 + jsonschema 验证

#### ProcessExecutionContext — 上下文管理器

`kernel/sys_lib.py:132` — Python Context Manager，核心执行环境

工作流程：
1. `__enter__`: 从 DB 恢复或新建 ContextStack → push 新帧 → 注入进程信息到 local_vars
2. `__exit__`: 计算哈希 → 若有变化则保存新快照到 DB → 捕获异常信息

#### ProcessCreator — 进程创建器

`kernel/sys_lib.py:260`

创建流程：
1. 从 `service_rule.target_service` 获取服务程序
2. 创建 Process 实例 (含父进程/前序/服务/操作员/实体等)
3. 若无显式 parent 则自指向
4. 创建业务记录 (`_create_business_record`)
5. 通过 ProcessExecutionContext 写入初始参数
6. 运行 RuleEvaluator 评估规则

**安全隐患：** `_create_business_record` 中使用 `eval(model_name)` 动态获取模型类 (`sys_lib.py:348`)

#### RuleEvaluator — 规则评估器

`kernel/sys_lib.py:360`

评估流程：
1. 从 `process.program_entrypoint` 获取服务程序
2. 查找匹配的 ServiceRule 集合 (`target_service=sp, service=process.service`)
3. 构建评估上下文 (合并 inherited_context + local_vars)
4. 对每条规则的 event.expression 调用 `eval()` 评估
5. 命中后通过 Celery 异步执行系统指令

**安全隐患：** `_evaluate_condition` 使用 `eval(expression, {}, context)` (`sys_lib.py:442`)

### 5.3 系统调用 (SysCall)

`kernel/sys_lib.py:500-776` — BPS Instruction 的实现

| 系统调用 | 类名 | 功能 |
|----------|------|------|
| `start_service` | StartService | 启动兄弟服务进程 (不影响当前进程) |
| `call_sub_service` | CallSubService | 调用子服务 (当前进程挂起 WAITING) |
| `calling_return` | CallingReturn | 从子服务返回 (子终止，父恢复 RUNNING) |
| `start_iteration_service` | StartIterationService | 循环启动同一服务 N 次 |
| `start_parallel_service` | StartParallelService | 并行启动同一服务给多个 Operator |

调用注册表 `CALL_REGISTRY` + 统一入口 `sys_call(name, **kwargs)`

### 5.4 任务列表与实时推送

- `update_task_list(operator, is_public)` — 刷新操作员任务列表并通过 Channel Layer 推送
- `update_entity_task_group_list(entity)` — 按状态分组刷新实体任务列表
- `search_profiles(search_content, search_text, operator)` — 全文搜索实体/服务
- `get_entity_profile(entity)` — 获取实体详情
- `get_represent_list(instances, work_order)` — 根据 WorkOrder 配置渲染数据列表
- `get_program_entrypoints(model_str)` — 获取可手动启动的服务程序入口点

### 5.5 WebSocket 路由

```
ws:/entity_task_list/<entity_id>/   → 实体任务列表
ws:/private_task_list/              → 个人任务列表
ws:/public_task_list/               → 公共任务列表
```

### 5.6 HTTP API 路由

```
POST   /api/token/                              → JWT 获取
POST   /api/token/refresh/                      → JWT 刷新
GET    /<site>/operator_context/                 → 操作员数据 + 实体类型
GET    /<site>/entity_operation/<type>/<id>/     → 实体操作页面
GET    /<site>/entity_context/<id>/              → 实体详情
POST   /<site>/search/                           → 搜索
POST   /<site>/new_service_process/<eid>/<srid>/ → 创建新服务进程
GET    /<site>/manage_task/                      → 任务管理
POST   /<site>/assign_operator/<pid>/            → 分配操作员
```

---

## 六、代码生成管线与 Application 层分析

### 6.1 核心发现：Application 层是自动生成的

Application 层的全部代码（`applications/models.py`、`applications/admin.py`、`kernel/app_types.py`）由 `design/utils.py:generate_source_code()` **从 DataItem 元定义自动生成**，并非手写代码。这是 BPS "元建模 → 代码生成 → 运行时部署" 理念的关键实现。

### 6.2 代码生成管线 (`design/utils.py`)

#### 触发入口

`design/admin.py:235-239` — Django Admin 中 Project 变更表单的"生成源码"按钮：

```python
def response_change(self, request, obj):
    if '_generate_source_code' in request.POST:
        generate_source_code(obj)
    return super().response_change(request, obj)
```

对应模板 `templates/project_changeform.html` 中的提交按钮。

#### 三阶段管线

**阶段一：`generate_script()` — 遍历 DataItem 生成源码**

`utils.py:303-403` — 对每个 `implement_type in ['Model', 'Log']` 的 DataItem：

1. **生成模型头部** — 类名由中文 label 经拼音转换得到，拼接 `ScriptFileHeader['class_base_fields']`（7 个通用字段）
2. **生成 master 外键** — 若 DataItem 有 `affiliated_to` 关系，自动生成 `master = models.ForeignKey(...)` 并沿继承链向上查找实际模型类
3. **`_generate_field_definitions()`** — 遍历 `DataItemConsists` 子项，按 `field_type` 分派生成对应 Django 字段定义：
   - CharField/TextField/IntegerField/BooleanField/DecimalField → 直接映射
   - DateTimeField/DateField/TimeField/JSONField/FileField → 直接映射
   - **TypeField** → 智能判断生成 ForeignKey 或 ManyToManyField（根据 `is_multivalued`），处理 `related_name` 冲突
   - User → OneToOneField
   - ComputedField → 跳过（不生成字段）
   - 处理 `business_type` 为 Reserved 的特殊字段名映射（如"计划时间" → `scheduled_time`）
4. **生成模型尾部** — Meta 类、`__str__`、`save()` 方法（来自 `script_file_header.py:get_model_footer()`）
5. **生成 Admin 脚本** — 自动注册 + list_display/search_fields/autocomplete_fields
6. **生成 CLASS_MAPPING** — 运行时字符串→类的查找字典
7. **生成 app_types** — 字段类型注册表（`kernel/app_types.py`）

**阶段二：写入文件 + 数据库迁移**

`utils.py:427-446`

```python
# 写入三个生成文件
'./applications/models.py'   # 领域模型
'./applications/admin.py'    # Admin 注册
'./kernel/app_types.py'      # 字段类型注册表

# 自动执行 Django 迁移
call_command('makemigrations', 'applications', '--noinput')
call_command('migrate', 'applications', '--noinput')
```

**阶段三：`copy_design_to_kernel()` + `import_init_data_from_data_item()`**

`utils.py:147-301` — Design → Kernel 数据复制

按依赖顺序复制 11 类模型（`COPY_CLASS_MAPPING`）：
```
无依赖：Organization, Resource, Event, Instruction, Form
一级：  Service (特殊处理: prepare_service_config 将丰富字段序列化为 config JSON)
        Role
二级：  Operator
三级：  ServiceRule, WorkOrder
```

复制策略：
- 以 `erpsys_id` 为匹配键执行 `update_or_create`
- 外键通过 `erpsys_id` 跨 app 查找目标实例
- ContentType 外键特殊处理（design app → kernel app 映射）
- M2M 关系二次遍历复制
- Service 的 config JSON 聚合了 consists/requirements/subject/route_to/program 等全部元信息

`utils.py:48-144` — 初始数据导入

对所有 `field_type in ['TypeField', 'Reserved']` 且有 `init_content` 的 DataItem：
- 解析 JSON 初始内容
- 按字段类型转换值（含 TypeField 的外键查找）
- `update_or_create` 到对应的 Design 或 Application 模型

#### 代码生成模板 (`design/script_file_header.py`)

| 模板键 | 内容 |
|--------|------|
| `models_file_head` | import 语句（django.db, uuid, re, pypinyin, kernel.models） |
| `class_base_fields` | 7 个通用字段（label/name/pym/erpsys_id/pid/created_time/updated_time） |
| `admin_file_head` | admin import 语句 |
| `fields_type_head` | app_types 变量头 |
| `get_model_footer()` | Meta/\_\_str\_\_/save() 方法模板 |
| `get_master_field_script()` | master ForeignKey 模板 |
| `get_admin_script()` | Admin 类注册模板 |

### 6.3 Design → Kernel → Application 数据流总结

```
┌─────────────────────────────────────────────────────────────────┐
│  DESIGN 层 (design/)                                            │
│                                                                  │
│  DataItem 元定义  ──generate_script()──→  applications/models.py │
│  (实体/字段/关系)                          applications/admin.py  │
│                                            kernel/app_types.py   │
│                                                     │            │
│  Service/Rule/Event/Instruction            makemigrations+migrate│
│  Role/Operator/Form/WorkOrder                       │            │
│          │                                          ↓            │
│          │  copy_design_to_kernel()         ┌──────────────────┐ │
│          └──────────────────────────────→   │  KERNEL 层数据    │ │
│                                             │  (运行时副本)     │ │
│  DataItem.init_content                      └──────────────────┘ │
│          │                                                       │
│          │  import_init_data_from_data_item()                    │
│          └──────────────────────────────→   APPLICATION 层初始数据│
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 Demo 领域模型 (医美诊所)

共 **28 个模型**，分为以下几类：

**字典/枚举模型 (7 个)：**
- FuWuLeiBie (服务类别)、RuChuKuCaoZuo (入出库操作)、KeHuLaiYuan (客户来源)
- HunFou (婚否)、ZhengZhuang (症状)、ZhenDuan (诊断)、ShouFeiLeiXing (收费类型)

**资源模型 (5 个)：**
- Material (物料)、Equipment (设备)、Device (工具)、Capital (资金)、Knowledge (知识)

**核心业务记录模型 (15 个)：**
- Profile (个人资料) — 最丰富的字段定义
- YuYueJiLu (预约记录) — 含预约时间/服务/医生/到店确认等
- JianKangDiaoChaJiLu (健康调查记录)
- ZhuanKePingGuJiLu (专科评估记录)
- ZhenDuanJiChuLiYiJianJiLu (诊断及处理意见记录)
- 六种治疗记录 (肉毒素/超声炮/黄金微针/调Q/光子/果酸/水光针)
- ChongZhiJiLu (充值记录)、XiaoFeiJiLu (消费记录)
- ShouFeiJiLu (收费记录) — 含应收/折扣/实收
- SuiFangJiLu (随访记录)
- FaSongZhiLiaoZhuYiShiXiangJiLu (治疗注意事项发送记录)
- QianShuZhiQingTongYiShuJiLu (知情同意书签署记录)
- DengLuQianDaoJiLu (签到记录)
- WuLiaoTaiZhang (物料台账)
- YuYueTiXingJiLu (预约提醒记录)
- ZhiLiaoXiangMuHeXiaoJiLu (治疗项目核销记录)
- Log (日志)

**CLASS_MAPPING** 字典 (28 项) 用于运行时通过字符串名查找模型类。

---

## 七、Design 层与 Kernel 层的模型双轨制分析

### 7.1 设计意图

Design 层和 Kernel 层的模型重复是**有意为之的架构决策**，而非无意的代码冗余。其核心逻辑是：

- **Design 层** = 设计时（Design-time）：保存完整的元建模信息，字段丰富，支持编辑
- **Kernel 层** = 运行时（Runtime）：仅保留执行引擎所需的精简信息
- **`copy_design_to_kernel()`** = 编译/部署：将设计时数据"编译"为运行时数据

这类似于编程语言中"源码 → 编译 → 字节码"的关系：Design 是源码，Kernel 是字节码。

### 7.2 具体映射关系

| 概念 | design/ (设计时) | kernel/ (运行时) | 编译策略 |
|------|------------------|------------------|----------|
| ERPSysBase | 有 | 有 | 共享抽象基类模式，UUID 生成略有不同 |
| Organization | 有 | 有 | 直接复制 |
| Role | 有 | 有 | 直接复制 (含 M2M services) |
| Operator | 有 | 有 (增加 GenericRelation) | 直接复制 + 运行时扩展 |
| Resource | 有 (多 res_type) | 有 (精简) | 字段裁剪 |
| Service | **丰富** (20+ 字段) | **精简** (仅 serve_content_type/manual_start/config) | `prepare_service_config()` 将设计时字段序列化为 config JSON |
| Event | 有 (多 is_timer) | 有 | 直接复制 |
| Instruction | 有 | 有 | 直接复制 |
| ServiceRule | 有 | 有 | 直接复制 + ContentType 重映射 |
| Form | 有 (含 FormFields) | 有 (无 fields) | 精简复制 |
| WorkOrder | 有 (含 WorkOrderFields) | 有 (无 fields) | 精简复制 |

### 7.3 Service 的编译策略详解

Design 层的 Service 拥有 20+ 字段（consists/subject/form/action_api/五类 requirements/program/route_to/reference 等），Kernel 层仅保留 `serve_content_type`、`manual_start` 和一个 `config` JSONField。

`prepare_service_config()` 将所有设计时信息聚合为一个 JSON：

```python
config = {
    "erpsys_id": ...,
    "serve_content_type": ...,
    "consists": [...],            # ServiceConsists 展平
    "action": {...},              # action_func_name + action_api
    "material_requirements": [...],  # 五类资源需求展平
    "equipment_requirements": [...],
    "device_requirements": [...],
    "capital_requirements": [...],
    "knowledge_requirements": [...],
    "subject": {...},             # 作业记录类型
    "price": ...,
    "route_to": {...},
    "reference": [...],
    "program": ...,               # 服务程序定义
    "service_type": ...,
    "primitive": ...,
    "manual_start": ...,
}
```

### 7.4 当前问题与改进空间

尽管双轨制是有意设计，仍存在可改进之处：

| 问题 | 说明 |
|------|------|
| ERPSysBase 重复定义 | 两层各自定义了几乎相同的抽象基类，可提取为共享基类 |
| 部分模型无实质差异 | Organization/Instruction 等在两层完全相同，可考虑共享 |
| 复制依赖关系隐式 | COPY_CLASS_MAPPING 的依赖顺序靠注释标注，无程序化拓扑排序 |
| ContentType 映射脆弱 | `copy_design_to_kernel()` 中假设 kernel 与 design 使用相同模型名 |
| 缺乏增量编译 | 每次"生成源码"都是全量重写+全量复制，无增量更新机制 |

---

## 八、关键数据流

### 8.1 服务进程创建流程

```
用户触发 "new_service_process" API
    ↓
views.py: 获取 entity + service_rule + operator
    ↓
ProcessCreator.create_process()
    ↓
1. 创建 Process 实例
2. 设置 parent/previous/service/operator
3. 创建业务记录 (eval 动态实例化)
4. ProcessExecutionContext 管理上下文
    ↓
5. RuleEvaluator.evaluate_rules(frame)
    ↓
6. 匹配 ServiceRule → 评估 Event.expression
    ↓
7. 命中 → execute_sys_call_task.delay() (Celery 异步)
    ↓
8. SysCall 执行 (StartService / CallSubService / ...)
    ↓
9. 递归创建子进程 / 修改进程状态
    ↓
10. WebSocket 推送任务列表更新
```

### 8.2 规则评估上下文构建

```
ContextFrame.local_vars = {
    'process_id': ...,
    'process_name': ...,
    'process_state': 'NEW',
    'process_service': 'yu_yue_guan_li',
    'process_operator': '小林',
    'process_priority': 0,
    'process_created_at': '...',
    'process_updated_at': '...',
    'service_program_id': '...',
    'service_rule_id': '...',
    # + init_params
    # + inherited_context from parent
}
```

Event.expression 示例: `process_state=='NEW'`

---

## 九、已识别问题与重构方向

### 9.1 架构层面

| # | 问题 | 严重程度 | 说明 |
|---|------|----------|------|
| A1 | Design/Kernel 双轨制可优化 | **中** | 双轨制是有意设计（设计时 vs 运行时），但 ERPSysBase 重复定义、部分无差异模型可共享、缺乏增量编译 |
| A2 | 代码生成模板未使用抽象基类 | **中** | `script_file_header.py` 将 7 个通用字段和 save() 作为字符串模板注入而非生成 Django 抽象基类继承，导致生成代码冗余（但这是生成器的模板问题，非手写问题） |
| A3 | 层间依赖方向 | **中** | `sys_lib.py` 使用 `from applications.models import *`，内核反向依赖应用层；但通过 CLASS_MAPPING 间接引用，实际耦合度可控 |
| A4 | 全量编译无增量 | **中** | 每次"生成源码"全量重写 models.py + 全量 copy_design_to_kernel()，无变更检测和增量更新 |
| A5 | copy_design_to_kernel 依赖顺序硬编码 | **低** | COPY_CLASS_MAPPING 的依赖顺序靠注释标注，无程序化拓扑排序 |

### 9.2 代码质量

| # | 问题 | 严重程度 | 位置 |
|---|------|----------|------|
| C1 | `eval()` 安全风险 | **高** | `sys_lib.py:348` (模型类实例化), `sys_lib.py:442` (表达式评估) |
| C2 | `from applications.models import *` | **高** | `sys_lib.py:23` — 命名空间污染，隐式依赖 |
| C3 | PidField 并发安全问题 | **中** | `kernel/models.py:191-201` — 非原子操作，并发时可能分配重复 PID |
| C4 | 大量注释掉的代码 | **低** | `sys_lib.py:406-470` — 规则评估器中有大段注释代码 |
| C5 | 缺乏异常处理层次 | **中** | SysCall 实现中 catch-all Exception，错误信息不够结构化 |
| C6 | print 调试语句残留 | **低** | 多处 `print()` 用于调试 |

### 9.3 设计模式

| # | 问题 | 严重程度 | 说明 |
|---|------|----------|------|
| D1 | 资源需求中间表重复 | **中** | Design 层 5 个 XxxRequirements 表结构完全一致，可泛化；但 Kernel 层已通过 config JSON 聚合 |
| D2 | ServiceBOM 方法重名 | **低** | `design/models.py:314-319` 两个 `add_sub_service` 方法同名 |
| D3 | 缺乏服务编排 DSL | **中** | Service.program 是 JSON 但无解释器实现，规则仅靠表达式 eval |
| D4 | WorkOrder 配置耦合 | **中** | 任务列表渲染依赖 WorkOrder 表中 label 硬编码匹配 |
| D5 | 代码生成器模板引擎原始 | **中** | 使用字符串拼接而非 Jinja2/AST 等成熟模板/代码生成技术 |

### 9.4 测试与工程化

| # | 问题 | 严重程度 | 说明 |
|---|------|----------|------|
| T1 | 无测试覆盖 | **高** | 三个 app 的 tests.py 均为空 |
| T2 | 无 CI/CD 配置 | **中** | 无 GitHub Actions 或类似配置 |
| T3 | 日志体系不完善 | **中** | settings.py 配置了日志但实际使用 print |
| T4 | 无数据迁移策略 | **中** | dev_initial.py 每次清除重建 |

### 9.5 已有 Todo (来自 todo.md)

```
上下文和服务数据结构重构
一. 按 o1 pro 的重构方案修改
   1. 修改：ServiceType, Models: ServiceServiceRule
   2. 修改：RuleEvaluator
二. 关联逻辑修改
   1. ServiceProgram 的引用
   2. service_program 的引用
   3. service_program_id
   4. 重构 get_program_entrypoints
```

---

## 十、BPS 规范与 erpsys 实现的映射对照

| BPS 概念 | erpsys 实现 | 映射质量 | 缺口 |
|----------|-------------|----------|------|
| Entity | DataItem (design) | 较好 | 缺乏子类定义表达式的运行时评估 |
| Service (原子/复合) | Service (design+kernel) | 部分 | primitive 标记存在但未深度区分编排 |
| Rule | ServiceRule + Event + Instruction | 较好 | 缺乏 NON_DETERMINISTIC 评估模式支持 |
| Role | Role + Operator | 较好 | 角色能力约束未在进程调度中强制执行 |
| Instruction | Instruction + SysCallInterface | 较好 | 缺少异常处理指令 (retry/terminate/escalate/rollback) |
| Process | Process + ProcessContextSnapshot | 较好 | 上下文管理实现完整 |
| Process 状态机 | ProcessState 枚举 | 较好 | 状态迁移约束未强制 (任意状态可直接赋值) |
| 设计器 | Django Admin (design app) | 基础 | 无可视化流程编排工具 |
| 运行时环境 | kernel 层 | 较好 | 事件监听机制依赖 Celery 轮询而非真正的事件驱动 |

---

## 十一、重构优先级建议

### P0 — 立即处理

1. **消除 eval() 安全风险** — `sys_lib.py:348` 使用 CLASS_MAPPING 白名单替代 `eval(model_name)`；表达式评估引入受限沙箱
2. **引入结构化日志** — 替换 print 为 logging，代码生成管线已部分使用 logging，统一标准

### P1 — 短期重构

3. **优化代码生成器模板** — `script_file_header.py` 中将 7 个通用字段 + save() 改为生成抽象基类继承，减少生成代码量
4. **优化 Design/Kernel 双轨制** — 提取共享 ERPSysBase 到公共模块；无差异模型（Organization/Instruction）评估是否可共享
5. **泛化 Design 层资源需求表** — 合并 5 个 XxxRequirements 为统一 ResourceRequirement
6. **修复 PidField 并发问题** — 使用数据库序列或原子操作
7. **完善 todo.md 中的上下文重构** — ServiceType/RuleEvaluator/service_program 引用重构

### P2 — 中期改进

8. **实现 BPS 缺失指令** — retry/terminate/escalate/rollback
9. **强化状态机约束** — 进程状态迁移验证（防止非法跳转）
10. **代码生成器增量编译** — 变更检测 + 增量迁移，替代全量重写
11. **建立测试框架** — 代码生成管线 + 核心引擎 + SysCall 的单元测试与集成测试

### P3 — 长期演进

12. **服务编排 DSL / 可视化编排器** — 替代 JSON 配置
13. **NON_DETERMINISTIC 事件支持** — 对接 AI Agent 判断能力
14. **前端独立化** — 从 Django Admin + Template 迁移至独立前端 (Vue/React)
15. **多租户支持** — 当前 CUSTOMER_SITE_NAME 为单一配置
16. **代码生成器升级** — 引入 AST/Jinja2 等成熟技术替代字符串拼接

---

## 十二、文件索引速查

| 文件 | 行数 | 核心职责 |
|------|------|----------|
| `design/models.py` | ~510 | 元模型定义 (DataItem, Service, ServiceRule, Event, Instruction, Form, Api 等) |
| `design/types.py` | ~103 | 枚举定义 (FieldType, ImplementType, ServiceType, ResourceType 等) |
| **`design/utils.py`** | **~454** | **代码生成管线核心** (generate_source_code, copy_design_to_kernel, generate_script) |
| **`design/script_file_header.py`** | **~69** | **代码生成模板** (通用字段/save方法/admin注册等模板) |
| `design/admin.py` | - | Admin 配置 + "生成源码"按钮触发入口 |
| `kernel/models.py` | ~345 | 运行时模型 (Process, ProcessContextSnapshot, Operator, Service 等) |
| `kernel/types.py` | ~60 | ProcessState 枚举 + CONTEXT_SCHEMA |
| `kernel/sys_lib.py` | ~980 | 核心引擎 (ContextFrame/Stack, ProcessCreator, RuleEvaluator, SysCalls) |
| `kernel/views.py` | ~14 | JWT 视图 |
| `kernel/app_types.py` | - | **生成文件** — 字段类型注册表 |
| `applications/models.py` | ~1075 | **生成文件** — 28 个领域模型 (医美诊所 Demo) |
| `applications/admin.py` | - | **生成文件** — Admin 注册 |
| `templates/project_changeform.html` | - | "生成源码"按钮 UI |
| `erpsys/settings.py` | - | Django 配置 (DB/Redis/JWT/CORS/Celery/Channels) |
| `erpsys/urls.py` | - | HTTP 路由 |
| `erpsys/asgi.py` | - | ASGI 配置 (HTTP + WebSocket) |
| `erpsys/celery.py` | - | Celery 配置 + Beat 调度 |
