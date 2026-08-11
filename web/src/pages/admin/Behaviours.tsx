/**
 * Admin › Behaviours (FR-23, admin-only): the fixed set of six CHAMP
 * behaviours — edit label, description, colour and active flag. No
 * create/delete by design.
 */
import React, { useState } from 'react'
import { api, ApiError } from '../../api'
import { useApi } from '../../hooks'
import type { Behaviour } from '../../types'
import { Button, Card, EmptyState, ErrorState, Field, Loading, Modal } from '../../components/ui'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export default function Behaviours(): React.ReactElement {
  const behaviours = useApi(() => api.behaviours(), [])
  const [editing, setEditing] = useState<Behaviour | null>(null)

  return (
    <>
      <Card
        title="CHAMP behaviours"
        sub="The fixed set of six — edit labels, descriptions and colours; deactivate rather than delete"
      >
        {behaviours.loading ? (
          <Loading label="Loading behaviours…" />
        ) : behaviours.error ? (
          <ErrorState error={behaviours.error} retry={behaviours.reload} />
        ) : behaviours.data && behaviours.data.length === 0 ? (
          <EmptyState title="No behaviours found" hint="The seed should have created the six CHAMP behaviours." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Colour</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {behaviours.data?.map((b) => (
                  <tr key={b.id} className={b.active ? '' : 'row-dim'}>
                    <td>
                      <span className="swatch" style={{ background: b.colour }} title={b.colour} />{' '}
                      <span className="mono">{b.colour}</span>
                    </td>
                    <td>
                      <strong>{b.name}</strong>
                    </td>
                    <td>{b.description}</td>
                    <td>
                      <span className={`badge ${b.active ? 'badge-active' : 'badge-neutral'}`}>
                        {b.active ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td>
                      <Button small onClick={() => setEditing(b)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <EditModal
          behaviour={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            behaviours.reload()
          }}
        />
      )}
    </>
  )
}

function EditModal({
  behaviour,
  onClose,
  onSaved,
}: {
  behaviour: Behaviour
  onClose: () => void
  onSaved: () => void
}): React.ReactElement {
  const [name, setName] = useState(behaviour.name)
  const [description, setDescription] = useState(behaviour.description)
  const [colour, setColour] = useState(behaviour.colour)
  const [active, setActive] = useState(!!behaviour.active)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const colourValid = HEX_RE.test(colour)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.updateBehaviour(behaviour.id, {
        name: name.trim(),
        description: description.trim(),
        colour: colour.toUpperCase(),
        active,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
      setBusy(false)
    }
  }

  return (
    <Modal title={`Edit “${behaviour.name}”`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          <Field label="Name">
            <input className="input" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Colour (used on chips, cards & charts)">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="color"
                value={colourValid ? colour : '#0F6B5C'}
                onChange={(e) => setColour(e.target.value.toUpperCase())}
                style={{ width: 40, height: 34, padding: 2, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }}
                aria-label="Colour picker"
              />
              <input
                className="input"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                pattern="#[0-9a-fA-F]{6}"
                placeholder="#0F6B5C"
                style={{ maxWidth: 120 }}
              />
            </div>
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="Description (shown in the WhatsApp behaviour picker)">
            <textarea
              className="textarea"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
        <label className="checkbox-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active — offered as a choice when giving recognition
        </label>
        {!colourValid && <div className="form-error">Colour must be a 6-digit hex value like #3B7DD8.</div>}
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!colourValid || !name.trim()}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  )
}
