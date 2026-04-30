// spring-backend/src/main/java/com/unity6/vita/entity/QuestionDifficile.java

package com.unity6.vita.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "tbl_questions_difficiles")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class QuestionDifficile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String question;

    @Column(name = "reponse_admin", columnDefinition = "TEXT")
    private String reponseAdmin;

    @Column(name = "date_creation", updatable = false)
    @CreationTimestamp
    private LocalDateTime dateCreation;

    @Column(name = "date_reponse")
    private LocalDateTime dateReponse;
}
