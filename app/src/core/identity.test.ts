import { describe, expect, it } from 'vitest'
import {
  duplicateAbilityNumbers,
  matchHorse,
  normalizeAbilityNumber,
  splitHorseName,
  type KnownHorse,
} from './identity'

const mare: KnownHorse = {
  id: 'H1',
  abilityNumber: '0x1234',
  birthYear: 1965,
  name: 'オオトリモナーコス',
  sireName: 'ハクリヨウ',
  damName: 'モナーコス',
}

describe('matchHorse', () => {
  it('能力番号與出生年都相同時是同一匹馬', () => {
    expect(matchHorse({ abilityNumber: '0x1234', birthYear: 1965 }, [mare])).toEqual({
      kind: 'same',
      id: 'H1',
    })
  })

  it('能力番号相同、出生年不同時是番号回收，建立新馬', () => {
    expect(
      matchHorse({ abilityNumber: '0x1234', birthYear: 1990, name: '別の馬' }, [mare]),
    ).toEqual({ kind: 'new' })
  })

  it('能力番号與出生年相同但馬名、父馬或母馬明顯不符時為衝突', () => {
    const incoming = { abilityNumber: '0x1234', birthYear: 1965 }
    expect(matchHorse({ ...incoming, name: '別の馬' }, [mare])).toEqual({
      kind: 'conflict',
      ids: ['H1'],
      reasons: ['name'],
    })
    expect(matchHorse({ ...incoming, sireName: '別の父', damName: '別の母' }, [mare])).toEqual({
      kind: 'conflict',
      ids: ['H1'],
      reasons: ['sire', 'dam'],
    })
  })

  it('只有一邊有馬名不算不符，例如還沒命名的產駒；前後空白也不算', () => {
    const foal = { id: 'F1', abilityNumber: '0x2000', birthYear: 1968 }
    expect(
      matchHorse({ abilityNumber: '0x2000', birthYear: 1968, name: 'ハイセイコー' }, [foal]),
    ).toEqual({ kind: 'same', id: 'F1' })
    expect(
      matchHorse({ abilityNumber: '0x1234', birthYear: 1965, name: ' オオトリモナーコス ' }, [
        mare,
      ]),
    ).toEqual({ kind: 'same', id: 'H1' })
  })

  it('手動輸入、尚未經匯入確認的馬名與匯入名稱不同時不算衝突', () => {
    const foal = {
      id: 'F1',
      abilityNumber: '0x2000',
      birthYear: 1968,
      name: 'ハイセイコ',
      manualName: true,
    }
    expect(
      matchHorse({ abilityNumber: '0x2000', birthYear: 1968, name: 'ハイセイコー' }, [foal]),
    ).toEqual({ kind: 'same', id: 'F1' })
  })

  it('既有紀錄沒有能力番号時，以唯一馬名輔助配對；出生年要相同或未填', () => {
    const incoming = { abilityNumber: '0x0100', birthYear: 1964, name: 'スターロツチ' }
    expect(matchHorse(incoming, [{ id: 'M1', name: 'スターロツチ' }])).toEqual({
      kind: 'assisted',
      id: 'M1',
    })
    expect(matchHorse(incoming, [{ id: 'M1', name: 'スターロツチ', birthYear: 1964 }])).toEqual({
      kind: 'assisted',
      id: 'M1',
    })
    expect(matchHorse(incoming, [{ id: 'M1', name: 'スターロツチ', birthYear: 1963 }])).toEqual({
      kind: 'new',
    })
  })

  it('以馬名配到的既有紀錄已有不同能力番号時為衝突，不得覆寫', () => {
    const known = [{ id: 'M1', name: 'スターロツチ', abilityNumber: '0x0200' }]
    expect(
      matchHorse({ abilityNumber: '0x0100', birthYear: 1964, name: 'スターロツチ' }, known),
    ).toEqual({ kind: 'conflict', ids: ['M1'], reasons: ['ability-number'] })
  })

  it('以馬名輔助配對時，父母明顯不符也是衝突', () => {
    const known = [{ id: 'M1', name: 'スターロツチ', damName: 'コロナ' }]
    expect(
      matchHorse(
        { abilityNumber: '0x0100', birthYear: 1964, name: 'スターロツチ', damName: '別の母' },
        known,
      ),
    ).toEqual({ kind: 'conflict', ids: ['M1'], reasons: ['dam'] })
  })

  it('馬名相符的既有紀錄有兩筆以上時無法判斷，列為衝突', () => {
    const known = [
      { id: 'M1', name: 'スターロツチ' },
      { id: 'M2', name: 'スターロツチ' },
    ]
    expect(
      matchHorse({ abilityNumber: '0x0100', birthYear: 1964, name: 'スターロツチ' }, known),
    ).toEqual({ kind: 'conflict', ids: ['M1', 'M2'], reasons: ['ambiguous'] })
  })

  it('沒有馬名、能力番号也配不到時建立新馬', () => {
    expect(matchHorse({ abilityNumber: '0x9999', birthYear: 1968 }, [mare])).toEqual({
      kind: 'new',
    })
  })
})

describe('duplicateAbilityNumbers', () => {
  it('列出重複的能力番号；沒有重複時為空陣列', () => {
    expect(duplicateAbilityNumbers(['0x0001', '0x0002', '0x0001', '0x0001'])).toEqual(['0x0001'])
    expect(duplicateAbilityNumbers(['0x0000', '0x0001'])).toEqual([])
  })
})

describe('splitHorseName', () => {
  it('去掉開頭的 (外) 或 [地] 得到基本馬名，完整馬名照原樣保存（需求規格 6.4、ID-09）', () => {
    expect(splitHorseName('(外)マルゼンスキー')).toEqual({
      fullName: '(外)マルゼンスキー',
      baseName: 'マルゼンスキー',
    })
    expect(splitHorseName('[地]ハイセイコー')).toEqual({
      fullName: '[地]ハイセイコー',
      baseName: 'ハイセイコー',
    })
    expect(splitHorseName('シンザン')).toEqual({ fullName: 'シンザン', baseName: 'シンザン' })
  })

  it('只有前綴、沒有馬名，或完整馬名空白時為資料異常，回傳 null', () => {
    expect(splitHorseName('(外)')).toBeNull()
    expect(splitHorseName('[地]  ')).toBeNull()
    expect(splitHorseName('')).toBeNull()
  })

  it('前綴只看開頭，馬名中間或結尾的括號不算', () => {
    expect(splitHorseName('シンザン(外)')?.baseName).toBe('シンザン(外)')
  })
})

describe('normalizeAbilityNumber', () => {
  it('統一成 0x 加 4 位大寫十六進位，忽略前後空白', () => {
    expect(normalizeAbilityNumber('0x030F')).toBe('0x030F')
    expect(normalizeAbilityNumber(' 0x30f ')).toBe('0x030F')
    expect(normalizeAbilityNumber('0XABCD')).toBe('0xABCD')
  })

  it('0x0000 是有效值（ID-12）', () => {
    expect(normalizeAbilityNumber('0x0000')).toBe('0x0000')
    expect(normalizeAbilityNumber('0x0')).toBe('0x0000')
  })

  it('沒有 0x、超過 4 位或不是十六進位時回傳 null', () => {
    expect(normalizeAbilityNumber('030F')).toBeNull()
    expect(normalizeAbilityNumber('0x12345')).toBeNull()
    expect(normalizeAbilityNumber('0xGHIJ')).toBeNull()
    expect(normalizeAbilityNumber('0x')).toBeNull()
    expect(normalizeAbilityNumber('')).toBeNull()
  })
})
