import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

type TableElement = ReactElement<{ children?: ReactNode; colSpan?: number; rowSpan?: number }>;

function namedElements(children: ReactNode, name: string): TableElement[] {
  return Children.toArray(children).filter(
    (child): child is TableElement => isValidElement(child) && child.type === name,
  );
}

function contents(element: TableElement): ReactNode {
  return element.props.children;
}

function tableRows(children: ReactNode) {
  const head = namedElements(children, 'thead')[0];
  const body = namedElements(children, 'tbody')[0];
  if (!head || !body) return null;
  const headerRow = namedElements(contents(head), 'tr')[0];
  if (!headerRow) return null;
  const headings = namedElements(contents(headerRow), 'th');
  const rows = namedElements(contents(body), 'tr').map((row) => namedElements(contents(row), 'td'));
  if (
    headings.length < 2 ||
    rows.length === 0 ||
    [...headings, ...rows.flat()].some((cell) => cell.props.colSpan || cell.props.rowSpan) ||
    rows.some((row) => row.length !== headings.length)
  )
    return null;
  return { headings: headings.map(contents), rows: rows.map((row) => row.map(contents)) };
}

/** Keep the semantic table on desktop and a labelled row view on narrow screens. */
export function ResponsiveAnswerTable({ children }: { children?: ReactNode }) {
  const rows = tableRows(children);
  return (
    <div className="connected-table-scroll" role="region" aria-label="Answer table" tabIndex={0}>
      <table>{children}</table>
      {rows && (
        <div className="connected-table-glossary">
          {rows.rows.map((cells, rowIndex) => (
            <div className="connected-table-entry" key={rowIndex}>
              <strong className="connected-table-entry-term">{cells[0]}</strong>
              <dl>
                {cells.slice(1).map((cell, columnIndex) => (
                  <div key={columnIndex}>
                    <dt>{rows.headings[columnIndex + 1]}</dt>
                    <dd>{cell}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
