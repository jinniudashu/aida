# AIDA erpsys 重构开发计划

> 范围：evaluation.md 6.2（工程化）+ 6.3（架构可优化项），6.1（安全/eval）暂不处理

---

## 阶段一：共享基础设施（6.3 架构优化前置）

### 1.1 提取 ERPSysBase 为共享模块

**问题：** design/models.py 和 kernel/models.py 各自定义了几乎相同的 ERPSysBase，存在细微不一致（label 的 blank 约束、erpsys_id 的 uuid 类型、`__str__` 返回值）。

**方案：** 新建 `erpsys/common/` Django app，提取统一的 ERPSysBase。

**涉及文件：**
- 新建 `erpsys/common/__init__.py`
- 新建 `erpsys/common/models.py` — 统一的 ERPSysBase 抽象基类
- 修改 `erpsys/design/models.py:15-36` — 删除 ERPSysBase，改为 `from common.models import ERPSysBase`
- 修改 `erpsys/kernel/models.py:17-38` — 同上
- 修改 `erpsys/erpsys/settings.py` — INSTALLED_APPS 添加 `'common'`

**统一行为：**
- `erpsys_id` 统一使用 `str(uuid.uuid1())`（kernel 的做法，存字符串）
- `label` 统一为 `blank=True, null=True`（design 的做法，更宽松）
- `__str__` 统一为 `return str(self.label)`（design 的做法，避免 None 报错）

**验证：** `python manage.py makemigrations` 无新迁移产生（抽象基类不影响数据库）

---

### 1.2 生成模板改用抽象基类继承

**问题：** `script_file_header.py` 将 7 个通用字段以字符串注入每个生成模型，28+ 个模型重复相同字段定义。

**方案：** 在 `common/models.py` 中新增 `ApplicationBaseModel(ERPSysBase)` 抽象基类（含 pid/created_time/updated_time），修改代码生成器使生成的类继承它。

**涉及文件：**
- 修改 `erpsys/common/models.py` — 新增 ApplicationBaseModel
- 修改 `erpsys/design/script_file_header.py` — models_file_head 改 import；删除 class_base_fields；新增 get_model_footer 使用简化版 save()
- 修改 `erpsys/design/utils.py:378-382` — 生成 `class Xxx(ApplicationBaseModel):` 而非 `class Xxx(models.Model):` + 字段注入

**ApplicationBaseModel 定义：**
```python
class ApplicationBaseModel(ERPSysBase):
    pid = models.ForeignKey('kernel.Process', on_delete=models.SET_NULL,
          blank=True, null=True, related_name='%(class)s_pid', verbose_name="作业进程")
    created_time = models.DateTimeField(auto_now_add=True, null=True, verbose_name="创建时间")
    updated_time = models.DateTimeField(auto_now=True, null=True, verbose_name="更新时间")

    class Meta:
        abstract = True
```

**生成模板简化后：** 生成的 save() 只保留 `super().save()` 调用（基类已处理通用逻辑），生成的类体只含业务字段 + Meta。

**验证：** 点击"生成源码"后，applications/models.py 生成正常，`makemigrations` 通过，原有功能不受影响。

---

### 1.3 消除内核对应用层的反向引用

**问题：** `kernel/sys_lib.py:22` 的 `from applications.models import *` 使内核依赖生成产物。

**方案：** 改为运行时动态导入，通过 Django ContentType + CLASS_MAPPING 延迟解析。

**涉及文件：**
- 修改 `erpsys/kernel/sys_lib.py:22` — 删除 `from applications.models import *`
- 修改 `erpsys/kernel/sys_lib.py:348` (`_create_business_record`) — 通过 `apps.get_model('applications', model_name)` 或延迟导入 CLASS_MAPPING
- 审查 sys_lib.py 中所有对 applications 模型的隐式引用，确保均走动态查找

**具体改法：**
```python
# 删除顶部 from applications.models import *
# 在需要时延迟导入：
def _get_app_model(model_name):
    from applications.models import CLASS_MAPPING
    return CLASS_MAPPING.get(model_name)
```

**验证：** 核心流程（创建进程/规则评估/任务列表）功能正常。

---

## 阶段二：工程化基础（6.2）

### 2.1 统一日志体系，替换 print

**问题：** 58 处 print 调试语句分布在 11 个文件中，kernel/sys_lib.py 无 logging import。

**方案：** 分文件逐步替换，按语义分级。

**涉及文件与规则：**

| 文件 | print 数 | 处理方式 |
|------|----------|----------|
| `kernel/sys_lib.py` | 4 active + 3 commented | 删除注释代码；active 改 logging.info/warning/error |
| `design/utils.py` | 15 | 已有 logging import，统一改用 logging |
| `kernel/admin.py` | 4 | 添加 logging import，替换 |
| `kernel/tasks.py` | 4 | 添加 logging import，替换 |
| `kernel/scheduler.py` | 1 | 添加 logging import，替换 |
| `erpsys/views.py` | 5 | 添加 logging import，替换 |

**日志分级规则：**
- 异常/错误 → `logging.error()`
- 警告（找不到对象等）→ `logging.warning()`
- 流程进度（迁移成功等）→ `logging.info()`
- 调试数据 → `logging.debug()`
- 注释掉的 print → 直接删除

**不处理的文件：** `dev_initial.py`、`dev_migrate.py`、`copy_static_files.py` 等开发/运维脚本保持 print（面向终端交互）。

**验证：** `grep -r "print(" erpsys/ --include="*.py"` 确认核心业务文件无残留 print。

---

### 2.2 修复 PidField 并发风险

**问题：** `kernel/models.py:191-201` PidField 的 pre_save 是非原子的读-改-写，并发创建进程可能产生重复 PID。

**方案：** 使用 `transaction.atomic()` + `select_for_update()` 保证原子性。

**涉及文件：**
- 修改 `erpsys/kernel/models.py:191-201`

**改法：**
```python
class PidField(models.IntegerField):
    def pre_save(self, model_instance, add):
        if add:
            with transaction.atomic():
                last = (Process.objects
                    .select_for_update()
                    .order_by('-pid')
                    .values_list('pid', flat=True)
                    .first())
                pid = (last or 0) + 1
            setattr(model_instance, self.attname, pid)
            return pid
        else:
            return super().pre_save(model_instance, add)
```

**验证：** 创建进程功能正常；PID 单调递增无重复。

---

### 2.3 消除 WorkOrder label 硬编码

**问题：** `kernel/sys_lib.py` 中 4 处通过 `WorkOrder.objects.get(label='xxx')` 硬编码查找工单配置，label 重命名即导致运行时崩溃。

**方案：** 在 `common/` 中定义 WorkOrder 标识常量，sys_lib.py 和 Design 层数据初始化统一引用。

**涉及文件：**
- 新建 `erpsys/common/constants.py`
- 修改 `erpsys/kernel/sys_lib.py` — 4 处硬编码改为常量引用

**常量定义：**
```python
# common/constants.py
class WorkOrderLabels:
    PUBLIC_TASK = '公共任务'
    PRIVATE_TASK = '私有任务'
    ENTITY_TASK_LIST = '实体作业任务清单'
    SEARCH_ENTITY = '搜索个人表头'
    SEARCH_SERVICE = '搜索服务表头'
    CUSTOMER_PROFILE = '客户Profile表头'
```

**验证：** 核心流程（任务列表/搜索/Profile）功能正常。

---

### 2.4 补充 CI 测试环节

**问题：** `.github/workflows/docker-deploy.yml` 只有部署步骤，无测试环节。

**方案：** 在现有 workflow 的 build 步骤前增加 test job。

**涉及文件：**
- 修改 `erpsys/.github/workflows/docker-deploy.yml` — 在 deploy 之前增加 test job
- 新建 `erpsys/conftest.py` — pytest Django 配置

**验证：** push 到 main 后 CI 先执行测试再部署。

---

### 2.5 建立核心测试覆盖

**问题：** 三个 app 的 tests.py 全部为空，零测试覆盖。

**方案：** 为三个关键模块编写测试，优先覆盖核心路径。

**测试文件与覆盖范围：**

| 文件 | 测试目标 | 用例数（预估） |
|------|----------|----------------|
| `kernel/tests.py` | ContextFrame/ContextStack 序列化往返；ProcessExecutionContext 快照保存/恢复/哈希检测；ProcessCreator 创建进程基本流程；RuleEvaluator 条件匹配/不匹配；5 个 SysCall 基本执行路径；PidField 自增正确性 | ~15 |
| `design/tests.py` | DataItem 创建与继承链遍历；generate_script 字段类型映射（每种 field_type 一个用例）；copy_design_to_kernel 基本复制逻辑；prepare_service_config 序列化完整性 | ~10 |
| `applications/tests.py` | 生成的模型 CRUD 基本操作；CLASS_MAPPING 完整性 | ~3 |

**验证：** `pytest` 全部通过。

---

## 阶段三：代码生成器增量编译（6.3）

### 3.1 增量编译机制

**问题：** 每次"生成源码"全量重写 applications/models.py + admin.py + app_types.py 并执行全量迁移。

**方案：** 引入内容哈希比对，仅在实际变化时写入和迁移。

**涉及文件：**
- 修改 `erpsys/design/utils.py:405-453`

**改法：**
```python
import hashlib

def _file_hash(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return hashlib.sha256(f.read().encode()).hexdigest()
    except FileNotFoundError:
        return None

# 生成完毕后，比对再写入
for file_name, content in object_files:
    new_hash = hashlib.sha256(content.encode()).hexdigest()
    if new_hash != _file_hash(file_name):
        with open(file_name, 'w', encoding='utf-8') as f:
            f.write(content)
        files_changed = True

# 仅在文件有变化时执行迁移
if files_changed:
    call_command('makemigrations', 'applications', '--noinput')
    call_command('migrate', 'applications', '--noinput')
```

**说明：** 这是文件级增量（非模型级），实现简单但已能避免大部分不必要的迁移。模型级增量（解析 AST diff）复杂度高，暂不在本轮范围内。

**验证：** 无变更时点击"生成源码"不触发迁移；有变更时正常生成和迁移。

---

## 执行顺序与依赖

```
阶段一 (架构基础)
  1.1 提取 ERPSysBase ──→ 1.2 生成模板改继承 ──→ 1.3 消除反向引用
                                    │
阶段二 (工程化)                      │（1.2 完成后重新生成 applications 代码）
  2.1 统一日志  ─────────────────────┤
  2.2 修复 PidField ─────────────────┤（可并行）
  2.3 WorkOrder 常量 ────────────────┤（可并行）
  2.4 CI 测试环节 ───→ 2.5 编写测试 ─┘

阶段三 (编译优化)
  3.1 增量编译 ──（依赖阶段一二全部完成）
```

## 验证方案

每个阶段完成后执行：

1. `python manage.py makemigrations --check` — 确认无意外的迁移变更
2. `python manage.py check` — Django 系统检查通过
3. 在 Design Admin 中点击"生成源码" — 代码生成管线正常
4. `pytest` — 全部测试通过
5. 手动创建服务进程 → 验证规则评估 → 验证任务列表推送 — 核心流程跑通
