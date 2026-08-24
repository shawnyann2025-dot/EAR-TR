import type { ScaleDegree } from './key'

export type DisplayScheme = 'solfege' | 'numeric' | 'degree'

const NUMERIC: Record<ScaleDegree, string> = {
  do: '1', ra: '♭2', re: '2', me: '♭3', mi: '3', fa: '4',
  fi: '♯4', sol: '5', le: '♭6', la: '6', te: '♭7', ti: '7',
}

const DEGREE: Record<ScaleDegree, string> = {
  do: '^1', ra: '♭^2', re: '^2', me: '♭^3', mi: '^3', fa: '^4',
  fi: '♯^4', sol: '^5', le: '♭^6', la: '^6', te: '♭^7', ti: '^7',
}

/** 把音级渲染成当前皮肤下的显示字符串。切皮肤不影响任何逻辑与进度数据。 */
export function displayDegree(degree: ScaleDegree, scheme: DisplayScheme): string {
  switch (scheme) {
    case 'solfege':
      return degree
    case 'numeric':
      return NUMERIC[degree]
    case 'degree':
      return DEGREE[degree]
  }
}
