/**
 * Recognition card (FR-15/FR-17): left border in the behaviour colour,
 * "Giver → Recipient", behaviour chip, reason, meta line (time-ago IST ·
 * site · function). Flagged items stay publicly indistinguishable (BR-5);
 * the status badge only renders when `showStatus` is set (admin views).
 */
import React from 'react'
import { Link } from 'react-router-dom'
import type { FeedItem } from '../types'
import { timeAgo } from '../format'
import { BehaviourChip, StatusBadge } from './ui'

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return (name[0] || 'E').toUpperCase()
}

export default function FeedCard({
  item,
  linkPeople = true,
  showStatus = false,
}: {
  item: FeedItem
  /** Wrap names in profile links (off for contexts without router/auth). */
  linkPeople?: boolean
  showStatus?: boolean
}): React.ReactElement {
  const name = (p: { id: number; name: string }) =>
    linkPeople ? (
      <Link to={`/people/${p.id}`} className="person-link">
        {p.name}
      </Link>
    ) : (
      <span className="person-name">{p.name}</span>
    )

  const giverInitials = getInitials(item.giver.name)
  const recipientInitials = getInitials(item.recipient.name)

  return (
    <article className="feed-card" style={{ borderLeftColor: item.behaviour.colour }}>
      <div className="feed-card-header">
        <div className="feed-avatars-flow">
          <div className="avatar-chip giver" title={item.giver.name}>
            <span>{giverInitials}</span>
          </div>
          <span className="avatar-flow-arrow">→</span>
          <div className="avatar-chip recipient" style={{ backgroundColor: item.behaviour.colour }} title={item.recipient.name}>
            <span>{recipientInitials}</span>
          </div>
        </div>

        <div className="feed-who">
          <div className="who-names">
            {name(item.giver)}
            <span className="feed-arrow" aria-label="recognised">
              recognised
            </span>
            {name(item.recipient)}
          </div>
          <div className="feed-meta-sub">
            <span className="meta-badge">{item.recipient.site}</span>
            <span className="meta-badge">{item.recipient.function}</span>
          </div>
        </div>

        <div className="feed-card-right">
          <BehaviourChip name={item.behaviour.name} colour={item.behaviour.colour} />
          {showStatus && item.status && <StatusBadge status={item.status} />}
        </div>
      </div>

      <div className="feed-reason-box">
        <p className="feed-reason">“{item.reason}”</p>
      </div>

      <div className="feed-footer">
        <span className="time-ago">🕒 {timeAgo(item.createdAt)}</span>
        <span className="channel-badge">{item.channel === 'whatsapp' ? '💬 WhatsApp' : '🌐 Web'}</span>
      </div>
    </article>
  )
}
