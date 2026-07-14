import type { ConfigIssue } from '../config/errors'

import './config-error.css'

const ERROR_TITLE_ID = 'config-error-title'

function appendDetail(
  document: Document,
  details: HTMLDListElement,
  label: string,
  value: string,
): void {
  const term = document.createElement('dt')
  term.textContent = label

  const description = document.createElement('dd')
  description.textContent = value

  details.append(term, description)
}

function createIssueItem(document: Document, issue: ConfigIssue): HTMLLIElement {
  const item = document.createElement('li')
  item.className = 'config-error__issue'

  const code = document.createElement('code')
  code.className = 'config-error__code'
  code.dataset.configErrorCode = ''
  code.textContent = issue.code

  const details = document.createElement('dl')
  details.className = 'config-error__details'
  appendDetail(document, details, '配置文件', issue.filePath)
  appendDetail(document, details, '字段路径', issue.fieldPath || '根节点')
  appendDetail(document, details, '原因', issue.messageZh)

  item.append(code, details)
  return item
}

export function renderConfigError(
  container: HTMLElement,
  issues: readonly ConfigIssue[],
): void {
  const document = container.ownerDocument
  const panel = document.createElement('main')
  panel.className = 'config-error'
  panel.dataset.configError = ''
  panel.setAttribute('role', 'alert')
  panel.setAttribute('aria-live', 'assertive')
  panel.setAttribute('aria-atomic', 'true')
  panel.setAttribute('aria-labelledby', ERROR_TITLE_ID)

  const title = document.createElement('h1')
  title.className = 'config-error__title'
  title.id = ERROR_TITLE_ID
  title.textContent = '配置加载失败'

  const summary = document.createElement('p')
  summary.className = 'config-error__summary'
  summary.textContent = issues.length > 0
    ? `发现 ${issues.length} 个配置问题，模拟器未启动。`
    : '配置未能通过校验，模拟器未启动。'

  panel.append(title, summary)

  if (issues.length > 0) {
    const list = document.createElement('ol')
    list.className = 'config-error__list'
    list.setAttribute('aria-label', '配置问题列表')

    for (const issue of issues) {
      list.append(createIssueItem(document, issue))
    }

    panel.append(list)
  }

  container.replaceChildren(panel)
  document.body.dataset.appState = 'config-error'
}
