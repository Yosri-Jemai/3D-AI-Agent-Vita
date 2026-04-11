package com.unity6.vita.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "tbl_conversation_extraction")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ConversationExtraction {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false)
    private Long sessionId;

    @Column(name = "profile_id", nullable = false)
    private Long profileId;

    @Column(columnDefinition = "JSON")
    private String products;

    @Column(columnDefinition = "JSON")
    private String objections;

    @Column(name = "engagement_score")
    private Integer engagementScore;

    @Column(columnDefinition = "JSON")
    private String topics;

    private String language;

    @Column(columnDefinition = "JSON")
    private String recommendations;

    @Column(name = "extracted_at", updatable = false)
    @CreationTimestamp
    private LocalDateTime extractedAt;
}