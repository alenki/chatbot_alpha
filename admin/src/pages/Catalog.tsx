import { useEffect, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut } from '../api'

interface Service {
  id: number
  name: string
  aliases: string[]
  description: string
  unit: string
  active: boolean
}

interface Option {
  id: number
  serviceId: number
  optionGroup: string
  name: string
  priceDelta: string
}

interface Tier {
  id: number
  serviceId: number
  minQty: number
  unitPrice: string
}

export default function Catalog() {
  const [services, setServices] = useState<Service[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null)
  const [options, setOptions] = useState<Option[]>([])
  const [tiers, setTiers] = useState<Tier[]>([])
  const [error, setError] = useState('')

  // new-service draft
  const [newName, setNewName] = useState('')
  const [newAliases, setNewAliases] = useState('')
  const [newUnit, setNewUnit] = useState('шт')

  // new-option draft
  const [newOptGroup, setNewOptGroup] = useState('')
  const [newOptName, setNewOptName] = useState('')
  const [newOptDelta, setNewOptDelta] = useState('0')

  // new-tier draft
  const [newTierQty, setNewTierQty] = useState('')
  const [newTierPrice, setNewTierPrice] = useState('')

  async function loadServices() {
    try {
      setServices(await apiGet<Service[]>('/api/catalog/services'))
    } catch (e) {
      setError(String(e))
    }
  }

  async function loadOptionsAndTiers(serviceId: number) {
    try {
      setOptions(await apiGet<Option[]>(`/api/catalog/options?serviceId=${serviceId}`))
      setTiers(await apiGet<Tier[]>(`/api/catalog/tiers?serviceId=${serviceId}`))
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    void loadServices()
  }, [])

  useEffect(() => {
    if (selectedServiceId !== null) void loadOptionsAndTiers(selectedServiceId)
    else {
      setOptions([])
      setTiers([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServiceId])

  function aliasesToString(aliases: string[]): string {
    return aliases.join(', ')
  }

  function stringToAliases(s: string): string[] {
    return s
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a !== '')
  }

  async function addService() {
    if (newName.trim() === '') return
    setError('')
    try {
      await apiPost('/api/catalog/services', {
        name: newName,
        aliases: stringToAliases(newAliases),
        unit: newUnit,
      })
      setNewName('')
      setNewAliases('')
      setNewUnit('шт')
      await loadServices()
    } catch (e) {
      setError(String(e))
    }
  }

  async function saveService(service: Service, aliasesInput: string) {
    setError('')
    try {
      await apiPut(`/api/catalog/services/${service.id}`, {
        name: service.name,
        aliases: stringToAliases(aliasesInput),
        unit: service.unit,
        active: service.active,
      })
      await loadServices()
    } catch (e) {
      setError(String(e))
    }
  }

  async function deleteService(id: number) {
    setError('')
    try {
      await apiDelete(`/api/catalog/services/${id}`)
      if (selectedServiceId === id) setSelectedServiceId(null)
      await loadServices()
    } catch (e) {
      setError(String(e))
    }
  }

  async function addOption() {
    if (selectedServiceId === null || newOptName.trim() === '') return
    setError('')
    try {
      await apiPost('/api/catalog/options', {
        serviceId: selectedServiceId,
        optionGroup: newOptGroup,
        name: newOptName,
        priceDelta: newOptDelta,
      })
      setNewOptGroup('')
      setNewOptName('')
      setNewOptDelta('0')
      await loadOptionsAndTiers(selectedServiceId)
    } catch (e) {
      setError(String(e))
    }
  }

  async function deleteOption(id: number) {
    if (selectedServiceId === null) return
    setError('')
    try {
      await apiDelete(`/api/catalog/options/${id}`)
      await loadOptionsAndTiers(selectedServiceId)
    } catch (e) {
      setError(String(e))
    }
  }

  async function addTier() {
    if (selectedServiceId === null || newTierQty === '' || newTierPrice === '') return
    setError('')
    try {
      await apiPost('/api/catalog/tiers', {
        serviceId: selectedServiceId,
        minQty: Number(newTierQty),
        unitPrice: newTierPrice,
      })
      setNewTierQty('')
      setNewTierPrice('')
      await loadOptionsAndTiers(selectedServiceId)
    } catch (e) {
      setError(String(e))
    }
  }

  async function deleteTier(id: number) {
    if (selectedServiceId === null) return
    setError('')
    try {
      await apiDelete(`/api/catalog/tiers/${id}`)
      await loadOptionsAndTiers(selectedServiceId)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div>
      <h1>Каталог</h1>
      {error !== '' && <div className="error">{error}</div>}

      <div className="section">
        <h2>Услуги</h2>
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Синонимы (через запятую)</th>
              <th>Ед.</th>
              <th>Активна</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <ServiceRow
                key={service.id}
                service={service}
                selected={service.id === selectedServiceId}
                aliasesToString={aliasesToString}
                onSelect={() => setSelectedServiceId(service.id)}
                onSave={saveService}
                onDelete={() => deleteService(service.id)}
              />
            ))}
            <tr className="inline-form">
              <td>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Визитки" />
              </td>
              <td>
                <input
                  value={newAliases}
                  onChange={(e) => setNewAliases(e.target.value)}
                  placeholder="визитка, business cards"
                />
              </td>
              <td>
                <input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
              </td>
              <td></td>
              <td>
                <button className="primary" onClick={() => void addService()}>
                  Добавить
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {selectedServiceId === null ? (
        <p style={{ color: '#999' }}>Выберите услугу, чтобы редактировать опции и цены.</p>
      ) : (
        <>
          <div className="section">
            <h2>Опции выбранной услуги</h2>
            <table>
              <thead>
                <tr>
                  <th>Группа</th>
                  <th>Название</th>
                  <th>Δ цены (₽/ед.)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {options.map((opt) => (
                  <tr key={opt.id}>
                    <td>{opt.optionGroup}</td>
                    <td>{opt.name}</td>
                    <td>{opt.priceDelta}</td>
                    <td>
                      <button onClick={() => void deleteOption(opt.id)}>Удалить</button>
                    </td>
                  </tr>
                ))}
                <tr className="inline-form">
                  <td>
                    <input
                      value={newOptGroup}
                      onChange={(e) => setNewOptGroup(e.target.value)}
                      placeholder="finishing"
                    />
                  </td>
                  <td>
                    <input
                      value={newOptName}
                      onChange={(e) => setNewOptName(e.target.value)}
                      placeholder="Ламинация матовая"
                    />
                  </td>
                  <td>
                    <input value={newOptDelta} onChange={(e) => setNewOptDelta(e.target.value)} />
                  </td>
                  <td>
                    <button className="primary" onClick={() => void addOption()}>
                      Добавить
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="section">
            <h2>Цены по тиражам</h2>
            <table>
              <thead>
                <tr>
                  <th>Мин. тираж</th>
                  <th>Цена за ед. (₽)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((tier) => (
                  <tr key={tier.id}>
                    <td>{tier.minQty}</td>
                    <td>{tier.unitPrice}</td>
                    <td>
                      <button onClick={() => void deleteTier(tier.id)}>Удалить</button>
                    </td>
                  </tr>
                ))}
                <tr className="inline-form">
                  <td>
                    <input
                      value={newTierQty}
                      onChange={(e) => setNewTierQty(e.target.value)}
                      placeholder="100"
                    />
                  </td>
                  <td>
                    <input
                      value={newTierPrice}
                      onChange={(e) => setNewTierPrice(e.target.value)}
                      placeholder="3.20"
                    />
                  </td>
                  <td>
                    <button className="primary" onClick={() => void addTier()}>
                      Добавить
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function ServiceRow({
  service,
  selected,
  aliasesToString,
  onSelect,
  onSave,
  onDelete,
}: {
  service: Service
  selected: boolean
  aliasesToString: (a: string[]) => string
  onSelect: () => void
  onSave: (service: Service, aliasesInput: string) => Promise<void>
  onDelete: () => void
}) {
  const [aliasesInput, setAliasesInput] = useState(aliasesToString(service.aliases))

  // Keep the local edit field in sync when the row's data changes underneath us.
  useEffect(() => {
    setAliasesInput(aliasesToString(service.aliases))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.aliases])

  return (
    <tr className={selected ? 'inline-form selected' : 'inline-form'} style={selected ? { background: '#eef4ff' } : undefined}>
      <td>
        <span onClick={onSelect} style={{ cursor: 'pointer', fontWeight: selected ? 700 : 400 }}>
          {service.name}
        </span>
      </td>
      <td>
        <input value={aliasesInput} onChange={(e) => setAliasesInput(e.target.value)} />
      </td>
      <td>{service.unit}</td>
      <td>{service.active ? 'да' : 'нет'}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button onClick={() => void onSave(service, aliasesInput)}>Сохранить</button>{' '}
        <button onClick={onDelete}>Удалить</button>
      </td>
    </tr>
  )
}
