import { describe, expect, it } from 'vitest'
import { calculate, formatCalculation } from './calc'

const answer = (input: string) => {
  const value = calculate(input)
  return value === null ? null : formatCalculation(value)
}

describe('calculate', () => {
  it('does the usual sums', () => {
    expect(answer('7*8')).toBe('56')
    expect(answer('7 x 8')).toBe('56')
    expect(answer('7×8÷2')).toBe('28')
    expect(answer('1+2*3')).toBe('7')
    expect(answer('(1+2)*3')).toBe('9')
    expect(answer('10/4')).toBe('2.5')
    expect(answer('0.1+0.2')).toBe('0.3')
    expect(answer('2^10')).toBe('1024')
    expect(answer('2**3**2')).toBe('512')
    expect(answer('-2^2')).toBe('-4')
    expect(answer('10 % 3')).toBe('1')
    expect(answer('1,000*3')).toBe('3000')
    expect(answer('5*3=')).toBe('15')
  })

  it('knows functions and constants', () => {
    expect(answer('sqrt(16)')).toBe('4')
    expect(answer('sqrt 16')).toBe('4')
    expect(answer('2pi')).toBe('6.28318530718')
    expect(answer('log(1000)')).toBe('3')
    expect(answer('ln(e)')).toBe('1')
    expect(answer('3(4+1)')).toBe('15')
  })

  it('shows huge, tiny and impossible answers sensibly', () => {
    expect(answer('1/0')).toBe('∞')
    expect(answer('10^20')).toBe('1e20')
    expect(answer('1/3')).toBe('0.333333333333')
  })

  it('leaves anything that is not a sum alone', () => {
    for (const input of ['42', '-5', 'pi', 'e', '(5)', 'weather 2+2 today', 'github.com', '192.168.1.1', '7*', '1,5+2', 'x', 'foo(2)', '']) {
      expect(calculate(input), input).toBeNull()
    }
  })
})
