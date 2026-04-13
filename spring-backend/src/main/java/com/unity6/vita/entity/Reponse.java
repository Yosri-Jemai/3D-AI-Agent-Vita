package com.unity6.vita.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "tbl_reponses")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Reponse {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "profile_id", nullable = false)
    private Profile profile;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "evaluation_id", nullable = false)
    private Evaluation evaluation;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String reponse;

    @Column(nullable = false)
    private Boolean correcte; // 1 si correcte , 0 sinon
}