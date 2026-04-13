package com.unity6.vita.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "tbl_interaction_session")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InteractionSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "profile_id", nullable = false)
    private Long profileId;

    @Column(name = "session_uuid", nullable = false, unique = true)
    private String sessionUuid;

    @Column(nullable = false)
    private String mode;

    @Column(name = "started_at", updatable = false)
    @CreationTimestamp
    private LocalDateTime startedAt;

    @Column(name = "ended_at")
    private LocalDateTime endedAt;

    public enum Mode {
        medical, commercial, vita_commercial
    }

    @PrePersist
    public void prePersist() {
        if (this.sessionUuid == null) {
            this.sessionUuid = UUID.randomUUID().toString();
        }
        if (this.startedAt == null) {
            this.startedAt = LocalDateTime.now();
        }
    }
}