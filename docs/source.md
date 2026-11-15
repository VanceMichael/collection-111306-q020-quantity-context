# 本地资料源约定

GET /api/document/:id 返回公告 HTML。fixtures/source.json 含章节单位、局部单位覆盖、跨表脚注、中文数量、范围、约数及非数量编号。原始预览只剥标签，不声称已识别数量。接收器已在 quantity-extraction 记录中携带 ruleVersion（见 src/quantity/rules.mjs）；源端 version 仅标识文稿。

## 通用控制

`GET /api/snapshot` 查看当前原始源状态；`POST /api/action` 接收 JSON 对象 `{"action":"动作名"}`。可用动作：reset、new-rule-context。控制只改变模拟源，不代表接收器已经处理了变化。

所有资料均由本项目构造，包含的机构、设备、会话和文件仅供本地使用，不访问真实账号。浏览器操作应通过正常可见界面；测试用源控制接口不是业务采集捷径。

## 来源证据

源端请求记录只用于核查服务行为，接收器自身的审计、状态和输出需由扩展功能负责。源端重启会恢复默认资料，但本地接收文件不会自动清空。
